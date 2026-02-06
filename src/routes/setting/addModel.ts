import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    type: z.string(),
    name: z.string(),
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    manufacturer: z.string(),
  }),
  async (req, res) => {
    const { type, name, model, baseUrl, apiKey, manufacturer } = req.body;

    await u.db("t_config").insert({
      type,
      name,
      model,
      baseUrl,
      apiKey,
      manufacturer,
      createTime: Date.now(),
      userId: 1,
    });
    res.status(200).send(success("新增成功"));
  },
);
