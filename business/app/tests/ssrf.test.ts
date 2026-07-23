import { describe, expect, it } from "vitest";
import { isPrivateIp, assertPublicHost, SsrfError } from "../src/lib/ssrf.js";

describe("isPrivateIp — IPv4", () => {
  const privates = [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "100.64.0.1", // CGNAT
    "100.127.255.254",
    "0.0.0.0",
    "0.1.2.3",
    "192.0.2.1", // documentation
    "198.51.100.7",
    "203.0.113.9",
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "255.255.255.255",
  ];
  for (const ip of privates) {
    it(`blocks ${ip}`, () => expect(isPrivateIp(ip)).toBe(true));
  }
  const publics = ["93.184.216.34", "8.8.8.8", "104.18.32.7", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1"];
  for (const ip of publics) {
    it(`allows ${ip}`, () => expect(isPrivateIp(ip)).toBe(false));
  }
  it("treats malformed addresses as unsafe", () => {
    expect(isPrivateIp("999.1.1.1")).toBe(true);
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("isPrivateIp — IPv6", () => {
  const privates = ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "::ffff:192.168.0.9", "64:ff9b::a00:1"];
  for (const ip of privates) {
    it(`blocks ${ip}`, () => expect(isPrivateIp(ip)).toBe(true));
  }
  const publics = ["2606:4700::6810:2007", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8"];
  for (const ip of publics) {
    it(`allows ${ip}`, () => expect(isPrivateIp(ip)).toBe(false));
  }
});

describe("assertPublicHost", () => {
  it("rejects IP literals in private space", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHost("169.254.169.254")).rejects.toBeInstanceOf(SsrfError);
  });
  it("accepts public IP literals", async () => {
    await expect(assertPublicHost("93.184.216.34")).resolves.toBeUndefined();
  });
  it("rejects localhost by resolution", async () => {
    await expect(assertPublicHost("localhost")).rejects.toBeInstanceOf(SsrfError);
  });
  it("allowPrivate bypasses for local demo mode", async () => {
    await expect(assertPublicHost("127.0.0.1", true)).resolves.toBeUndefined();
    await expect(assertPublicHost("localhost", true)).resolves.toBeUndefined();
  });
  it("throws a friendly error for unresolvable domains", async () => {
    await expect(assertPublicHost("definitely-not-a-real-domain-xyzzy.invalid")).rejects.toThrow(/couldn't find/i);
  });
});
