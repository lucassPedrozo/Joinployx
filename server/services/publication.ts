import sodium from 'libsodium-wrappers'
import {
  createGitHubHeaders,
  createOrUpdateFile,
  getGitHubBaseUrl,
  GitHubRequestError,
  describeGitHubFailure,
  type GitHubConfig,
} from './github'
import type { PublicationResult, WorkflowWriteStatus } from '../../src/shared/deploy'

type RepositoryPublicKey = {
  key_id: string
  key: string
}

/** `value: null` remove o secret do repositório em vez de gravá-lo. */
export type PublicationSecret = {
  name: string
  value: string | null
}

export type PublicationConfig = {
  config: GitHubConfig
  owner: string
  repo: string
  secrets: PublicationSecret[]
  workflows: PublicationWorkflow[]
  workflowBranch?: string
}

export type PublicationWorkflow = {
  path: string
  content: string
  message?: string
}

const defaultWorkflowBranch = 'main'
const defaultWorkflowMessage = 'Adicionar workflow de publicacao'
const REQUEST_TIMEOUT_MS = 20_000

const isConflictError = (error: unknown) =>
  error instanceof GitHubRequestError && error.status === 409

const send = async (url: string, config: GitHubConfig, init: RequestInit) => {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...createGitHubHeaders(config),
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? 'O GitHub não respondeu dentro do tempo limite.'
      : 'Não foi possível alcançar a API do GitHub.'
    throw new GitHubRequestError(reason, 504)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new GitHubRequestError(describeGitHubFailure(response.status, body), response.status)
  }

  return response
}

const requestJson = async <T>(
  url: string,
  config: GitHubConfig,
  init: RequestInit
): Promise<T> => {
  const response = await send(url, config, init)
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

const requestNoContent = async (
  url: string,
  config: GitHubConfig,
  init: RequestInit
) => {
  const response = await send(url, config, init)
  await response.body?.cancel().catch(() => undefined)
}

const getRepositoryPublicKey = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
}) => {
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/actions/secrets/public-key`
  return requestJson<RepositoryPublicKey>(url, params.config, { method: 'GET' })
}

const encryptSecret = async (value: string, publicKey: string) => {
  // GitHub Actions secrets use libsodium sealed box encryption.
  await sodium.ready
  const messageBytes = new TextEncoder().encode(value)
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL)
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes)
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL)
}

const secretUrl = (config: GitHubConfig, owner: string, repo: string, name: string) =>
  `${getGitHubBaseUrl(config)}/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`

const setRepositorySecret = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  name: string
  value: string
  publicKey: RepositoryPublicKey
}) => {
  const encryptedValue = await encryptSecret(params.value, params.publicKey.key)

  await requestNoContent(secretUrl(params.config, params.owner, params.repo, params.name), params.config, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      encrypted_value: encryptedValue,
      key_id: params.publicKey.key_id,
    }),
  })
}

const deleteRepositorySecret = async (params: {
  config: GitHubConfig
  owner: string
  repo: string
  name: string
}) => {
  try {
    await requestNoContent(secretUrl(params.config, params.owner, params.repo, params.name), params.config, {
      method: 'DELETE',
    })
  } catch (error) {
    // Remover um secret inexistente é o estado desejado, não uma falha.
    if (error instanceof GitHubRequestError && error.status === 404) return
    throw error
  }
}

export const configurePublication = async (
  params: PublicationConfig
): Promise<PublicationResult> => {
  const workflowBranch = params.workflowBranch ?? defaultWorkflowBranch
  const workflows = params.workflows

  if (!workflows || workflows.length === 0) {
    throw new Error('Nenhum workflow fornecido para publicação.')
  }

  const secretsToSet = params.secrets.filter(
    (secret): secret is { name: string; value: string } =>
      typeof secret.value === 'string' && secret.value.trim().length > 0
  )
  const secretsToRemove = params.secrets.filter((secret) => secret.value === null)

  if (secretsToSet.length > 0) {
    const publicKey = await getRepositoryPublicKey({
      config: params.config,
      owner: params.owner,
      repo: params.repo,
    })

    await Promise.all(
      secretsToSet.map((secret) =>
        setRepositorySecret({
          config: params.config,
          owner: params.owner,
          repo: params.repo,
          name: secret.name,
          value: secret.value,
          publicKey,
        })
      )
    )
  }

  await Promise.all(
    secretsToRemove.map((secret) =>
      deleteRepositorySecret({
        config: params.config,
        owner: params.owner,
        repo: params.repo,
        name: secret.name,
      })
    )
  )

  const workflowStatuses: WorkflowWriteStatus[] = []

  const createOrUpdateWorkflow = async (workflow: PublicationWorkflow) => {
    try {
      return await createOrUpdateFile({
        config: params.config,
        owner: params.owner,
        repo: params.repo,
        path: workflow.path,
        content: workflow.content,
        message: workflow.message ?? defaultWorkflowMessage,
        branch: workflowBranch,
      })
    } catch (error) {
      // Dois workflows gravados em sequência disputam o mesmo HEAD; o 409
      // significa apenas que o SHA envelheceu entre a leitura e a escrita.
      if (!isConflictError(error)) {
        throw error
      }

      return await createOrUpdateFile({
        config: params.config,
        owner: params.owner,
        repo: params.repo,
        path: workflow.path,
        content: workflow.content,
        message: workflow.message ?? defaultWorkflowMessage,
        branch: workflowBranch,
      })
    }
  }

  for (const workflow of workflows) {
    workflowStatuses.push(await createOrUpdateWorkflow(workflow))
  }

  return {
    workflowPaths: workflows.map((workflow) => workflow.path),
    workflowBranch,
    secretNames: secretsToSet.map((secret) => secret.name),
    workflowStatuses,
  }
}
