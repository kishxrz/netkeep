"""
NetKeep Cyber Cafe — Terminal Agent Simulator
Simulates real PC workstations running client software, reporting CPU/RAM metrics,
sending periodic heartbeats, and responding to lock/unlock commands.
"""

import time
import random
import httpx

SERVER_URL = "http://localhost:8000/api/v1"

def run_simulation(iterations: int = 5, delay: float = 2.0):
    print("=" * 60)
    print("  NETKEEP CYBER CAFE — CLIENT TERMINAL SIMULATOR")
    print(f"  Target Server: {SERVER_URL}")
    print("=" * 60)

    try:
        with httpx.Client(timeout=3.0) as client:
            # 1. Fetch current stations
            resp = client.get(f"{SERVER_URL}/stations")
            if resp.status_code != 200:
                print(f"[Error] Failed to fetch stations: {resp.status_code}")
                return

            stations = resp.json()
            print(f"[Simulator] Discovered {len(stations)} workstations.")

            for i in range(1, iterations + 1):
                print(f"\n--- Simulation Cycle {i}/{iterations} ---")
                for s in stations[:8]:  # Simulate first 8 workstations
                    st_id = s["id"]
                    st_code = s["station_code"]

                    cpu = round(random.uniform(12.0, 85.0), 1)
                    ram = round(random.uniform(25.0, 78.0), 1)
                    process = random.choice(["steam.exe", "valorant.exe", "chrome.exe", "discord.exe", "idle"])

                    hb_payload = {
                        "ip_address": s["ip_address"],
                        "cpu_usage_pct": cpu,
                        "ram_usage_pct": ram,
                        "active_process": process
                    }

                    hb_resp = client.post(f"{SERVER_URL}/stations/{st_id}/heartbeat", json=hb_payload)
                    if hb_resp.status_code == 200:
                        data = hb_resp.json()
                        lock_status = "LOCKED" if data.get("is_locked") else "UNLOCKED"
                        print(f"[{st_code}] Heartbeat OK | {data.get('status')} | {lock_status} | CPU: {cpu}% | RAM: {ram}% | Task: {process}")
                    else:
                        print(f"[{st_code}] Heartbeat FAILED: {hb_resp.status_code}")

                time.sleep(delay)

            print("\n[Simulator] Completed simulation cycles.")

    except httpx.RequestError as exc:
        print(f"[Simulator Error] Could not connect to Local Server: {exc}")
        print("Ensure local-server is running on http://localhost:8000")

if __name__ == "__main__":
    run_simulation()
