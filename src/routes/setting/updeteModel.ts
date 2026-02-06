import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    type: z.string(),
    name: z.string(),
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    manufacturer: z.string(),
  }),
  async (req, res) => {
    const { id, type, name, model, baseUrl, apiKey, manufacturer } = req.body;

    await u.db("t_config").where("id", id).update({
      type,
      name,
      model,
      baseUrl,
      apiKey,
      manufacturer,
    });
    res.status(200).send(success("编辑成功"));
  },
);
