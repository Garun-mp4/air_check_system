import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceDir = "C:\\Users\\admin\\Desktop\\ВКР";
const buildDir = path.join(workspaceDir, ".codex-pptx-build");
const skillDir = "C:\\Users\\admin\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.905.11957\\skills\\presentations";
const candidatePath = path.join(buildDir, "aircheck-aktualnost-draft.pptx");
const finalPath = path.join(workspaceDir, "docs", "pptx-output", "AirCheck_актуальность_темы.pptx");
const pythonExecutable = "C:\\Users\\admin\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

await fs.mkdir(path.dirname(finalPath), { recursive: true });

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
    "--require-native-table-slide", "4",
  ],
  requiredNativeTableOwnerSlides: [4],
  fontPolicy: { basis: "design", families: ["Helvetica Neue"] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(buildDir, "AirCheck_актуальность_validation.json"),
});

console.log(JSON.stringify(result, null, 2));
