import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Card, CardContent, CardTitle } from "@/front/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/front/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/front/components/ui/sheet";
import { Skeleton } from "@/front/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/front/components/ui/tabs";
import { Textarea } from "@/front/components/ui/textarea";

describe("基础 UI 组件", () => {
  it("Button 支持点击与禁用", async () => {
    const onClick = vi.fn();
    render(
      <>
        <Button onClick={onClick}>开始找人</Button>
        <Button disabled>已禁用</Button>
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "开始找人" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "已禁用" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Dialog 可以打开、关闭并支持键盘 Esc", async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>打开弹窗</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>确认模拟支付</DialogTitle>
          <DialogDescription>不会产生扣款。</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    await userEvent.click(screen.getByRole("button", { name: "打开弹窗" }));
    expect(await screen.findByText("确认模拟支付")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("确认模拟支付")).not.toBeInTheDocument(),
    );
  });

  it("Sheet 可以打开并通过关闭按钮关闭", async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>查看证据</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>内容证据</SheetTitle>
          <SheetDescription>证据抽屉</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    await userEvent.click(screen.getByRole("button", { name: "查看证据" }));
    expect(await screen.findByText("内容证据")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(screen.queryByText("内容证据")).not.toBeInTheDocument(),
    );
  });

  it("Textarea 支持输入并保留受控值", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <Textarea
          aria-label="问题"
          value={value}
          maxLength={10}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    render(<Harness />);

    const textarea = screen.getByLabelText("问题");
    await userEvent.type(textarea, "大厂转创业");
    expect(textarea).toHaveValue("大厂转创业");
  });

  it("Tabs 切换会展示对应内容", async () => {
    render(
      <Tabs defaultValue="seeker">
        <TabsList>
          <TabsTrigger value="seeker">用户视角</TabsTrigger>
          <TabsTrigger value="creator">答主视角</TabsTrigger>
        </TabsList>
        <TabsContent value="seeker">用户内容</TabsContent>
        <TabsContent value="creator">答主内容</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("用户内容")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "答主视角" }));
    expect(await screen.findByText("答主内容")).toBeInTheDocument();
  });

  it("Badge / Card / Skeleton 渲染基础结构", () => {
    render(
      <Card>
        <CardTitle>卡片标题</CardTitle>
        <CardContent>
          <Badge variant="outline">经历最接近</Badge>
          <Skeleton className="h-4 w-10" data-testid="skeleton" />
        </CardContent>
      </Card>,
    );

    expect(screen.getByText("卡片标题")).toBeInTheDocument();
    expect(screen.getByText("经历最接近")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });
});
