import buildWorkflowTemplate from '../../workflows/build.yml?raw'
import deployWorkflowTemplate from '../../workflows/deploy-via-ftp.yml?raw'
import detectPackageManagerScript from '../../workflows/scripts/detect-package-manager.sh?raw'
import installAndBuildScript from '../../workflows/scripts/install-and-build.sh?raw'
import resolveBuildOutputScript from '../../workflows/scripts/resolve-build-output.sh?raw'
import {
  readTemplateVersion,
  renderWorkflow,
  WORKFLOW_TEMPLATE_VERSION,
  type WorkflowRenderOptions,
  type WorkflowScripts,
} from './workflow-render'

export const workflowScripts: WorkflowScripts = {
  __DETECT_PACKAGE_MANAGER__: detectPackageManagerScript,
  __INSTALL_AND_BUILD__: installAndBuildScript,
  __RESOLVE_BUILD_OUTPUT__: resolveBuildOutputScript,
}

export const DEPLOY_WORKFLOW_FILE = 'Deploy-via-FTP.yml'
export const BUILD_WORKFLOW_FILE = 'Build.yml'

export const buildWorkflowFiles = (options: WorkflowRenderOptions) => [
  {
    path: `.github/workflows/${BUILD_WORKFLOW_FILE}`,
    // O workflow de build roda a cada push por definição; o gatilho automático
    // de publicação é decidido apenas no workflow de deploy.
    content: renderWorkflow(buildWorkflowTemplate, workflowScripts, { ...options, autoDeploy: false }),
    message: 'Adicionar workflow de build',
  },
  {
    path: `.github/workflows/${DEPLOY_WORKFLOW_FILE}`,
    content: renderWorkflow(deployWorkflowTemplate, workflowScripts, options),
    message: 'Adicionar workflow de deploy via FTP',
  },
]

export { readTemplateVersion, renderWorkflow, WORKFLOW_TEMPLATE_VERSION }
export type { WorkflowRenderOptions }
