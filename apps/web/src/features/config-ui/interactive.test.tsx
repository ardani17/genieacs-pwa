import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigDeviceFaultsView, SummonButtonView } from "./interactive";
import { DeviceTaskFault } from "../devices/device-task-fault";

const ctx = {
  device: { "DeviceID.ID": { value: ["TEST-FAULT-1", "xsd:string"] } },
  now: 1,
} as never;

it("Summon uses a fresh ID after a confirmed result and retains uncertain IDs", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            operationId: body.operationId,
            state: "succeeded",
            phases: [],
          },
        }),
      );
    });
  render(<SummonButtonView node={{ type: "summon-button" }} ctx={ctx} />);
  const button = screen.getByRole("button", { name: "Summon" });
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const ids = fetcher.mock.calls.map(
    ([, init]) => JSON.parse(String(init?.body)).operationId,
  );
  expect(ids[0]).not.toBe(ids[1]);
  await waitFor(() => expect(button).toBeEnabled());
  fetcher.mockRejectedValueOnce(new TypeError("lost response"));
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).operationId).toBe(
    JSON.parse(String(fetcher.mock.calls[3][1]?.body)).operationId,
  );
});

it.each(["config", "detail"])(
  "%s fault view queries the native device field",
  async (view) => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const filter = new URL(
          String(input),
          "http://localhost",
        ).searchParams.get("filter");
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              items:
                filter === 'device = "TEST-FAULT-1"'
                  ? [
                      {
                        _id: "TEST-FAULT-1:task_1",
                        code: "9003",
                        message: "Fixture fault",
                      },
                    ]
                  : [],
            },
          }),
        );
      });
    if (view === "config") render(<ConfigDeviceFaultsView ctx={ctx} />);
    else render(<DeviceTaskFault deviceId="TEST-FAULT-1" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(await screen.findByText("Fixture fault")).toBeVisible();
  },
);

it("Summon reads the configured native parameter paths", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: { operationId: "fixture", state: "succeeded", phases: [] },
      }),
    ),
  );
  render(
    <SummonButtonView
      node={{
        type: "summon-button",
        parameters: {
          "0": ["PARAM", "Device.DeviceInfo.SoftwareVersion"],
          "1": ["PARAM", ["||", "Device.", "DeviceInfo.SerialNumber"]],
        },
      }}
      ctx={ctx}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Summon" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).tasks).toEqual([
    {
      name: "getParameterValues",
      parameterNames: [
        "Device.DeviceInfo.SoftwareVersion",
        "Device.DeviceInfo.SerialNumber",
      ],
    },
  ]);
});

it("Summon fallback uses a TR-181 device's actual root", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: { operationId: "fixture", state: "succeeded", phases: [] },
      }),
    ),
  );
  render(
    <SummonButtonView
      node={{ type: "summon-button" }}
      ctx={
        {
          device: {
            "DeviceID.ID": { value: ["TEST-181", "xsd:string"] },
            "Device.DeviceInfo.SoftwareVersion": {
              value: ["fixture", "xsd:string"],
            },
          },
          now: 1,
        } as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Summon" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).tasks).toEqual([
    { name: "getParameterValues", parameterNames: ["Device."] },
  ]);
});
