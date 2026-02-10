import "../type";
import axios from "axios";
import sharp from "sharp";
import FormData from "form-data";
import { pollTask, validateVideoConfig } from "@/utils/ai/utils";
import { createOpenAI } from "@ai-sdk/openai";

export default async (input: VideoConfig, config: AIConfig) => {
  if (!config.apiKey) throw new Error("缺少API Key");
  if (!config.baseURL) throw new Error("缺少baseURL");
  // const { owned, images, hasTextType } = validateVideoConfig(input, config);

  const [requestUrl, queryUrl] = config.baseURL.split("|");

  const authorization = `Bearer ${config.apiKey}`;

  const formData = new FormData();
  formData.append("model", config.model);
  formData.append("prompt", input.prompt);
  formData.append("seconds", String(input.duration));

  // 根据 aspectRatio 设置 size
  const sizeMap: Record<string, string> = {
    "16:9": "1920x1080",
    "9:16": "1080x1920",
  };
  formData.append("size", sizeMap[input.aspectRatio] || "1920x1080");
  if (input.imageBase64 && input.imageBase64.length) {
    const base64Data = input.imageBase64[0]!.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    formData.append("input_reference", buffer, { filename: "image.jpg", contentType: "image/jpeg" });
  }
  const { data } = await axios.post(requestUrl, formData, {
    headers: { "Content-Type": "application/json", Authorization: authorization, ...formData.getHeaders() },
  });
  if (data.status === "FAILED") throw new Error(`任务提交失败: ${data.errorMessage || "未知错误"}`);
  const taskId = data.id;
  return await pollTask(async () => {
    const { data } = await axios.get(`${queryUrl.replace("{id}", taskId)}`, {
      headers: { Authorization: authorization },
    });

    if (data.status === "SUCCESS") {
      return data.results?.length ? { completed: true, url: data.results[0].url } : { completed: false, error: "任务成功但未返回视频链接" };
    }
    if (data.status === "FAILED") return { completed: false, error: `任务失败: ${data.errorMessage || "未知错误"}` };
    if (data.status === "QUEUED" || data.status === "RUNNING") return { completed: false };
    return { completed: false, error: `未知状态: ${data.status}` };
  });
};
