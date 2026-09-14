import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "@/front/app/App";

describe("应用骨架", () => {
  it("默认以 Mock 模式启动并渲染项目推荐页", async () => {
    render(<App />);

    expect(await screen.findByText("知乎问人")).toBeInTheDocument();
    expect(screen.getByText("找到真正经历过的人")).toBeInTheDocument();
    expect(screen.getByText("知乎黑客松 Demo")).toBeInTheDocument();
  });

  it("项目推荐页只介绍项目并给出两个出口", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /找到一个问题开始|从一个问题开始/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/查看 GitHub 项目|GitHub 地址暂未配置/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /进入在线网站/ })).toHaveAttribute(
      "href",
      "/app",
    );
  });
});
