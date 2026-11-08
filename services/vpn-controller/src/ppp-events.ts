import { isIPv4, connect } from "node:net";

export interface PppEvent {
  type: "up" | "down";
  interfaceName: string;
  localIp: string;
  peerIp: string;
  generation: string;
}
export function parsePppEvent(value: unknown): PppEvent {
  const r = value as PppEvent;
  if (
    !r ||
    typeof r !== "object" ||
    Object.keys(r).some(
      (k) =>
        !["type", "interfaceName", "localIp", "peerIp", "generation"].includes(
          k,
        ),
    ) ||
    !["up", "down"].includes(r.type) ||
    !/^ppp\d{1,3}$/.test(r.interfaceName) ||
    !isIPv4(r.localIp) ||
    !isIPv4(r.peerIp) ||
    !/^[0-9a-f-]{36}$/.test(r.generation)
  )
    throw new Error("INVALID_PPP_EVENT");
  return r;
}
export function authenticationRejected(line: string): boolean {
  return (
    /(?:PAP|CHAP).*authentication (?:failed|failure)|authentication failed|(?:exit(?:ed)?(?: with)? (?:code|status)|status\s*=)\s*19\b/i.test(
      line,
    ) || pppExitCode(line) === 19
  );
}
export function pppExitCode(line: string): number | null {
  const match = /pppd exited for call \d+ with code (\d+)\b/.exec(line);
  return match ? Number(match[1]) : null;
}
// pppd's hook ABI: interface tty speed local-ip remote-ip ipparam.
export async function sendPppEvent(
  socketPath: string,
  argv: string[],
): Promise<void> {
  if (argv.length !== 7) throw new Error("INVALID_PPP_HOOK");
  const event = parsePppEvent({
    type: argv[0],
    interfaceName: argv[1],
    localIp: argv[4],
    peerIp: argv[5],
    generation: argv[6],
  });
  await new Promise<void>((resolve, reject) => {
    const socket = connect(socketPath, () =>
      socket.end(JSON.stringify(event) + "\n"),
    );
    socket.setTimeout(2000, () =>
      socket.destroy(new Error("PPP_EVENT_TIMEOUT")),
    );
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      if (!hadError) resolve();
    });
  });
}
