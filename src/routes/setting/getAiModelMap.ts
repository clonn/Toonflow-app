import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const configData = await u
    .db("t_prompts")
    .leftJoin("t_aiModelMap", "t_prompts.id", "t_aiModelMap.promptsId")
    .leftJoin("t_config", "t_config.id", "t_aiModelMap.configId")
    .select("t_prompts.id as promptsId", "t_prompts.code", "t_prompts.name", "t_config.model", "t_aiModelMap.id");
  res.status(200).send(success(configData));
});
