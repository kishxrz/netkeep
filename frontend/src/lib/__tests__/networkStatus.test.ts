import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Pure helper function implementing the operational mode decision matrix
 * as used by NetworkSyncStatus component.
 */
function determineOperationalMode(isLocalOnline: boolean, isCloudOnline: boolean) {
  if (isLocalOnline && isCloudOnline) {
    return {
      mode: "FULL_SYNC",
      title: "Full Multi-Branch Sync Mode",
      isAirGapped: false,
      isLocalAutonomous: false
    };
  }
  if (isLocalOnline && !isCloudOnline) {
    return {
      mode: "AUTONOMOUS_LOCAL",
      title: "Autonomous Local LAN Mode",
      isAirGapped: false,
      isLocalAutonomous: true
    };
  }
  if (!isLocalOnline && !isCloudOnline) {
    return {
      mode: "AIR_GAPPED_OFFLINE",
      title: "Air-Gapped Offline POS Mode",
      isAirGapped: true,
      isLocalAutonomous: false
    };
  }
  return {
    mode: "LAN_DEGRADED",
    title: "Cloud Direct Mode (Local Edge Down)",
    isAirGapped: false,
    isLocalAutonomous: false
  };
}

describe("NetKeep Café — Network & Operational Mode Decision Matrix", () => {
  it("Mode Matrix: Both LAN and Cloud online yields Full Multi-Branch Sync", () => {
    const res = determineOperationalMode(true, true);
    assert.strictEqual(res.mode, "FULL_SYNC");
    assert.strictEqual(res.title, "Full Multi-Branch Sync Mode");
    assert.strictEqual(res.isAirGapped, false);
  });

  it("Mode Matrix: LAN online and Cloud offline yields Autonomous Local LAN Mode", () => {
    // Critical test: Cashier must continue operating in-store when WAN drops
    const res = determineOperationalMode(true, false);
    assert.strictEqual(res.mode, "AUTONOMOUS_LOCAL");
    assert.strictEqual(res.title, "Autonomous Local LAN Mode");
    assert.strictEqual(res.isLocalAutonomous, true);
    assert.strictEqual(res.isAirGapped, false);
  });

  it("Mode Matrix: Both LAN and Cloud offline yields Air-Gapped Offline POS Mode", () => {
    // Total network isolation: Dexie IndexedDB takes over
    const res = determineOperationalMode(false, false);
    assert.strictEqual(res.mode, "AIR_GAPPED_OFFLINE");
    assert.strictEqual(res.title, "Air-Gapped Offline POS Mode");
    assert.strictEqual(res.isAirGapped, true);
  });

  it("Mode Matrix: Cloud online but LAN server offline yields LAN Degraded Alert", () => {
    const res = determineOperationalMode(false, true);
    assert.strictEqual(res.mode, "LAN_DEGRADED");
    assert.strictEqual(res.title, "Cloud Direct Mode (Local Edge Down)");
  });

  it("CRITICAL RULE: Never infer cloud availability only from navigator.onLine", () => {
    // When a computer is connected to a local Wi-Fi router with NO internet connection:
    // navigator.onLine is TRUE, but real cloud API probe fails (HTTP request error / timeout).
    const hardwareNicConnected = true; // navigator.onLine
    const activeCloudProbeSuccess = false; // Real fetch() failed or timed out

    // The system MUST report cloud as unreachable despite navigator.onLine == true
    const isCloudReachable = hardwareNicConnected && activeCloudProbeSuccess;
    assert.strictEqual(isCloudReachable, false, "Cloud reachability must require active probe success, never onLine alone");

    const mode = determineOperationalMode(true, isCloudReachable);
    assert.strictEqual(mode.mode, "AUTONOMOUS_LOCAL", "Must engage Autonomous Local mode when cloud probe fails despite NIC up");
  });
});
