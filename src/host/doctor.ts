import { discoverHardware } from "./hardware.ts";

if (
  Number(process.versions.node.split(".")[0]) < 24 ||
  process.getuid?.() === 0
) {
  console.error("Use Node 24+ with an unprivileged account.");
  process.exitCode = 1;
} else {
  const report = discoverHardware(process.env.ACOS_DATA_DIR ?? process.cwd());
  console.log(JSON.stringify(report, null, 2));
  if (!report.isolation.available) {
    console.warn("ACOS can run without inference. " + report.isolation.reason);
  }
  console.log(
    "Inventory does not prove model compatibility. Model load performs resource admission and an isolated health check.",
  );
}
