import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ApiError, isAbortError } from "@/front/api/ApiError";
import { useApiClient, useRefreshSession } from "@/front/app/api-context";
import { consultationSchema, type ConsultationAction, type ConsultationPackage } from "@/shared/contracts/consultation";
import type { Conversation } from "@/shared/contracts/conversation";
import { API_ERROR_CODES } from "@/shared/contracts/errors";

import {
  conversationItemsReducer,
  createInitialItemsState,
} from "@/front/features/chat/conversation-state";
import { readText, removeText, STORAGE_KEYS, writeText } from "@/front/shared/storage";

export type ConversationLoadStatus = "loading" | "ready" | "not-found" | "error";

export type UiError = {
  code: string;
  message: string;
  retryable: boolean;
  status: number;
};

export function toUiError(caught: unknown, fallback: string): UiError {
  if (caught instanceof ApiError) {
    return {
      code: caught.code,
      message: caught.message,
      retryable: caught.retryable,
      status: caught.status,
    };
  }
  return { code: "UNKNOWN_ERROR", message: fallback, retryable: true, status: 0 };
}

/* ------------------------------------------------------------------ */
/* 搜索结果 → 会话：创建并跳转                                         */
/* ------------------------------------------------------------------ */

export function useStartConversation() {
  const client = useApiClient();
  const refreshSession = useRefreshSession();
  const [pendingCreatorId, setPendingCreatorId] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [lastInput, setLastInput] = useState<{
    creatorId: string;
    sourceRunId: string | null;
  } | null>(null);
  const inFlightRef = useRef(false);

  const start = useCallback(
    async (creatorId: string, sourceRunId: string | null) => {
      // 重复点击只发一次请求：请求进行中直接忽略后续点击。
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setPendingCreatorId(creatorId);
      setError(null);
      setLastInput({ creatorId, sourceRunId });

      try {
        const conversation = await client.createConversation({
          creatorId,
          sourceRunId,
        });
        setPendingCreatorId(null);
        setLastInput(null);
        return conversation;
      } catch (caught) {
        const uiError = toUiError(caught, "创建会话失败，请重试。");
        if (uiError.status === 401) {
          setError({ ...uiError, message: "知乎授权已失效，请重新授权。", retryable: false });
          refreshSession();
        } else if (uiError.code === API_ERROR_CODES.conversationSourceUnavailable) {
          setError({
            ...uiError,
            message: "这次搜索的运行记录已经过期，无法据此创建会话。",
          });
        } else {
          setError(uiError);
        }
        setPendingCreatorId(null);
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    [client, refreshSession],
  );

  const retry = useCallback(async () => {
    if (!lastInput) return null;
    return start(lastInput.creatorId, lastInput.sourceRunId);
  }, [lastInput, start]);

  return { pendingCreatorId, error, start, retry, canRetry: Boolean(lastInput) };
}

/* ------------------------------------------------------------------ */
/* 聊天页状态                                                          */
/* ------------------------------------------------------------------ */

export type ViewerRole = "seeker" | "creator";

function demoRoleSwitcherEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_DEMO_ROLE_SWITCHER !== "false";
}

export function useConversation(conversationId: string) {
  const client = useApiClient();
  const refreshSession = useRefreshSession();

  const [loadStatus, setLoadStatus] = useState<ConversationLoadStatus>("loading");
  const [loadError, setLoadError] = useState<UiError | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [packages, setPackages] = useState<ConsultationPackage[]>([]);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [itemsState, dispatch] = useReducer(
    conversationItemsReducer,
    undefined,
    createInitialItemsState,
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [messageError, setMessageError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<ViewerRole>("seeker");
  const [attempt, setAttempt] = useState(0);

  const streamAbortRef = useRef<AbortController | null>(null);
  const lastAttemptRef = useRef<{
    clientMessageId: string;
    content: string;
    role: ViewerRole;
  } | null>(null);
  const roleReadyRef = useRef(false);

  /* ---------------- 草稿与偏好（只保存前端状态） ---------------- */

  useEffect(() => {
    const stored = readText(STORAGE_KEYS.viewerRole);
    if (stored === "creator" || stored === "seeker") setViewerRole(stored);
    roleReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!roleReadyRef.current) return;
    writeText(STORAGE_KEYS.viewerRole, viewerRole);
  }, [viewerRole]);

  useEffect(() => {
    setDraft(readText(STORAGE_KEYS.messageDraft(conversationId)) ?? "");
  }, [conversationId]);

  /**
   * 草稿是「用户可见状态」，因此就地落盘而不是交给 effect：
   * effect 无法区分「刚 hydrate 出来的草稿」和「用户输入的草稿」，
   * 会在挂载那一趟把读到的内容又写回或清掉。空草稿等于没有草稿，
   * 所以写空串等同于删除 key。
   */
  const updateDraft = useCallback(
    (next: string) => {
      setDraft(next);
      const key = STORAGE_KEYS.messageDraft(conversationId);
      if (next.length > 0) writeText(key, next);
      else removeText(key);
    },
    [conversationId],
  );

  /* ---------------- 加载：Conversation + 第一页 Message + 套餐 ---------------- */

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadStatus("loading");
    setLoadError(null);
    setNotice(null);

    void (async () => {
      try {
        const [loadedConversation, messages] = await Promise.all([
          client.getConversation(conversationId, controller.signal),
          client.listMessages(conversationId, undefined, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setConversation(loadedConversation);
        dispatch({
          type: "server.loaded",
          messages: messages.items,
          nextCursor: messages.nextCursor,
        });
        setLoadStatus("ready");
      } catch (caught) {
        if (controller.signal.aborted || isAbortError(caught)) return;
        const uiError = toUiError(caught, "加载会话失败，请重试。");
        if (uiError.status === 401) {
          setLoadError({ ...uiError, message: "知乎授权已失效，请重新授权。" });
          refreshSession();
        } else if (uiError.status === 404) {
          setLoadStatus("not-found");
          setLoadError(uiError);
          return;
        } else {
          setLoadError(uiError);
        }
        setLoadStatus("error");
      }
    })();

    return () => controller.abort();
  }, [client, conversationId, refreshSession, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    client
      .getConsultationPackages(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setPackages(items);
        setPackagesError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || isAbortError(caught)) return;
        setPackagesError(
          caught instanceof Error ? caught.message : "咨询套餐暂时不可用。",
        );
      });
    return () => controller.abort();
  }, [client]);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  /* ---------------- 发送 ---------------- */

  const streamAgentReply = useCallback(
    async (clientMessageId: string, content: string) => {
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setStreaming(true);
      setMessageError(null);
      dispatch({ type: "pending.agent", clientMessageId });

      try {
        const completed = await client.streamConversationAgent(
          conversationId,
          { clientMessageId, content },
          (event) => {
            if (event.type === "agent.run.started") {
              dispatch({ type: "user.confirmed", message: event.userMessage });
            } else if (event.type === "agent.message.started") {
              dispatch({ type: "agent.started", messageId: event.messageId });
            } else if (event.type === "agent.message.delta") {
              dispatch({
                type: "agent.delta",
                messageId: event.messageId,
                delta: event.delta,
              });
            }
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;
        // 流结束只代表传输完成；气泡内容一律以服务端完整 Message 为准。
        dispatch({ type: "agent.completed", message: completed.message });
        setStreaming(false);
      } catch (caught) {
        setStreaming(false);
        if (controller.signal.aborted || isAbortError(caught)) {
          // 取消只影响这次请求：已确认的用户消息保留，未成型的 Agent 气泡丢弃。
          dispatch({ type: "agent.cancelled" });
          return;
        }
        const uiError = toUiError(caught, "Agent 回复失败，请重试。");
        if (uiError.status === 401) refreshSession();
        setMessageError(uiError);
        dispatch({ type: "agent.failed" });
      }
    },
    [client, conversationId, refreshSession],
  );

  const sendPlainMessage = useCallback(
    async (clientMessageId: string, content: string, role: ViewerRole) => {
      setSending(true);
      setMessageError(null);
      try {
        const message = await client.sendMessage(conversationId, {
          clientMessageId,
          actorRole: role,
          content,
        });
        dispatch({ type: "user.confirmed", message });
      } catch (caught) {
        const uiError = toUiError(caught, "消息发送失败，请重试。");
        if (uiError.status === 401) refreshSession();
        setMessageError(uiError);
        dispatch({ type: "agent.failed" });
      } finally {
        setSending(false);
      }
    },
    [client, conversationId, refreshSession],
  );

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || streaming) return;
    const clientMessageId = crypto.randomUUID();
    lastAttemptRef.current = { clientMessageId, content, role: viewerRole };
    updateDraft("");
    dispatch({
      type: "pending.user",
      clientMessageId,
      content,
      sender: viewerRole,
    });

    if (viewerRole === "creator") {
      await sendPlainMessage(clientMessageId, content, "creator");
      return;
    }
    await streamAgentReply(clientMessageId, content);
  }, [
    draft,
    sendPlainMessage,
    sending,
    streamAgentReply,
    streaming,
    updateDraft,
    viewerRole,
  ]);

  /** 重试复用同一个 clientMessageId，避免同一句话在服务端出现两次。 */
  const retryLast = useCallback(async () => {
    const attemptInput = lastAttemptRef.current;
    if (!attemptInput || sending || streaming) return;
    dispatch({ type: "retry.pending", clientMessageId: attemptInput.clientMessageId });
    if (attemptInput.role === "creator") {
      await sendPlainMessage(
        attemptInput.clientMessageId,
        attemptInput.content,
        "creator",
      );
      return;
    }
    await streamAgentReply(attemptInput.clientMessageId, attemptInput.content);
  }, [sendPlainMessage, sending, streamAgentReply, streaming]);

  const cancelStream = useCallback(() => {
    streamAbortRef.current?.abort();
    setStreaming(false);
    dispatch({ type: "agent.cancelled" });
  }, []);

  const discardItem = useCallback((itemId: string) => {
    dispatch({ type: "item.discarded", itemId });
  }, []);

  const loadOlder = useCallback(async () => {
    if (!itemsState.nextCursor || itemsState.loadingOlder) return;
    dispatch({ type: "loading.older" });
    try {
      const page = await client.listMessages(conversationId, itemsState.nextCursor);
      dispatch({
        type: "older.loaded",
        messages: page.items,
        nextCursor: page.nextCursor,
      });
    } catch (caught) {
      dispatch({ type: "older.loaded", messages: [], nextCursor: itemsState.nextCursor });
      setMessageError(toUiError(caught, "加载更早的消息失败。"));
    }
  }, [client, conversationId, itemsState.loadingOlder, itemsState.nextCursor]);

  /* ---------------- 咨询动作：状态由服务端决定 ---------------- */

  const applyConsultationAction = useCallback(
    async (action: ConsultationAction, packageId?: string) => {
      if (!conversation || actionPending) return;
      setActionPending(true);
      setNotice(null);
      try {
        const result = await client.applyConsultationAction(conversationId, {
          action,
          actorRole: viewerRole,
          packageId,
        });
        setConversation((current) =>
          current ? { ...current, consultation: result.consultation } : current,
        );
        dispatch({ type: "server.appended", message: result.systemMessage });
      } catch (caught) {
        const parsedDetails =
          caught instanceof ApiError ? consultationSchema.safeParse(caught.details) : null;
        if (
          caught instanceof ApiError &&
          caught.code === API_ERROR_CODES.invalidConsultationTransition &&
          parsedDetails?.success
        ) {
          // 409：用服务端返回的当前咨询状态回正 UI，不自行推导。
          const serverConsultation = parsedDetails.data;
          setConversation((current) =>
            current ? { ...current, consultation: serverConsultation } : current,
          );
          setNotice(caught.message);
          return;
        }
        const uiError = toUiError(caught, "咨询操作失败，请重试。");
        if (uiError.status === 401) refreshSession();
        setNotice(uiError.message);
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, client, conversation, conversationId, refreshSession, viewerRole],
  );

  /* ---------------- reset ---------------- */

  const reset = useCallback(async () => {
    if (actionPending) return;
    setActionPending(true);
    setNotice(null);
    try {
      const result = await client.resetConversation(conversationId);
      setConversation(result.conversation);
      dispatch({ type: "reset", messages: result.messages });
      removeText(STORAGE_KEYS.messageDraft(conversationId));
      setDraft("");
    } catch (caught) {
      // reset 失败时保持旧页面，只提示错误。
      const uiError = toUiError(caught, "重置会话失败，请重试。");
      if (uiError.status === 401) refreshSession();
      setNotice(uiError.message);
    } finally {
      setActionPending(false);
    }
  }, [actionPending, client, conversationId, refreshSession]);
  const roleSwitcherEnabled = useMemo(() => demoRoleSwitcherEnabled(), []);

  return {
    loadStatus,
    loadError,
    conversation,
    packages,
    packagesError,
    items: itemsState.items,
    nextCursor: itemsState.nextCursor,
    loadingOlder: itemsState.loadingOlder,
    draft,
    setDraft: updateDraft,
    sending,
    streaming,
    actionPending,
    messageError,
    notice,
    dismissNotice: () => setNotice(null),
    viewerRole,
    setViewerRole,
    roleSwitcherEnabled,
    reload,
    send,
    retryLast,
    cancelStream,
    discardItem,
    loadOlder,
    applyConsultationAction,
    reset,
  };
}

export type ConversationController = ReturnType<typeof useConversation>;
