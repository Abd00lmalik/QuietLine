import { describe, expect, it } from "vitest";
import type { Address, Log } from "viem";
import { requestIdFromReceipt } from "./receipts";

const vault = "0x0A7fF224174896A743B41491f0Ef8036B32Fc5E4" as Address;
const requestId =
  "0x894b52b25881decf3b950d8a1a210f81202e79a0c8aa4f7d9ef5b340fc0c625f";

describe("requestIdFromReceipt", () => {
  it("decodes the real Coston2 FXRP DepositSubmitted log", () => {
    const log = {
      address: vault,
      topics: [
        "0xbd19995d91692d2901dc7dc6ff25417050a6740ede0fd91605a2996c552636a1",
        "0x0f0d966af232ccffce320ebe368fad876e680f318b0f0827a43f5a720d8a6b84",
        "0x000000000000000000000000694e614b5e958791bf0cae682257af806b1b13e3",
        "0x0000000000000000000000000b6a3645c240605887a5532109323a3e12273dc7",
      ],
      data:
        "0x0000000000000000000000000000000000000000000000000000000000989680" +
        requestId.slice(2),
    } as unknown as Log;

    expect(requestIdFromReceipt({ logs: [log] }, vault, "DepositSubmitted")).toBe(
      requestId,
    );
  });

  it("ignores an identical event emitted by another contract", () => {
    const foreignLog = {
      address: "0x1111111111111111111111111111111111111111",
      topics: [],
      data: "0x",
    } as unknown as Log;

    expect(() =>
      requestIdFromReceipt({ logs: [foreignLog] }, vault, "DepositSubmitted"),
    ).toThrow("did not include a request id");
  });
});
