import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceDir = "C:\\Users\\admin\\Desktop\\ВКР";
const buildDir = path.join(workspaceDir, ".codex-pptx-build");
const skillDir = "C:\\Users\\admin\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.905.11957\\skills\\presentations";
const candidatePath = path.join(buildDir, "aircheck-redesign-draft.pptx");
const finalPath = path.join(workspaceDir, "docs", "pptx-output", "AirCheck_актуальность_темы_редизайн_v6.pptx");
const pythonExecutable = "C:\\Users\\admin\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

const { finalizePresentation } = await import(
  pathToFileURL(path.join(skillDir, "container_tools", "artifact_tool_utils.mjs")).href,
);

const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable,
  integrityValidatorPath: path.join(skillDir, "container_tools", "inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(skillDir, "container_tools", "inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu", "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: { basis: "design", families: ["Helvetica Neue"] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(buildDir, "AirCheck_актуальность_редизайн_v6_validation.json"),
});

console.log(JSON.stringify(result, null, 2));
