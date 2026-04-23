import { describe, it, expect } from "vitest";
import { resolveDisplayName } from "./displayName";

describe("resolveDisplayName", () => {
  const account = "2021001";

  it("有姓名：返回 profile.full_name", () => {
    expect(resolveDisplayName({ full_name: "张三" }, account)).toBe("张三");
  });

  it("有姓名（带空格）：trim 后返回", () => {
    expect(resolveDisplayName({ full_name: "  李四  " }, account)).toBe("李四");
  });

  it("无姓名（null）：回退到 account", () => {
    expect(resolveDisplayName({ full_name: null }, account)).toBe(account);
  });

  it("无姓名（空字符串）：回退到 account", () => {
    expect(resolveDisplayName({ full_name: "" }, account)).toBe(account);
  });

  it("无姓名（仅空白）：回退到 account", () => {
    expect(resolveDisplayName({ full_name: "   " }, account)).toBe(account);
  });

  it("查询失败（profile 为 null）：回退到 account", () => {
    expect(resolveDisplayName(null, account)).toBe(account);
  });

  it("查询失败（profile 为 undefined）：回退到 account", () => {
    expect(resolveDisplayName(undefined, account)).toBe(account);
  });

  it("姓名与 account 都缺失：返回空字符串", () => {
    expect(resolveDisplayName(null, "")).toBe("");
  });
});