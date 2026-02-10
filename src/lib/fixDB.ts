import { Knex } from "knex";

export default async (knex: Knex): Promise<void> => {
  const addColumn = async (table: string, column: string, type: string) => {
    if (!(await knex.schema.hasTable(table))) return;
    if (!(await knex.schema.hasColumn(table, column))) {
      await knex.schema.alterTable(table, (t) => (t as any)[type](column));
    }
  };

  const dropColumn = async (table: string, column: string) => {
    if (!(await knex.schema.hasTable(table))) return;
    if (await knex.schema.hasColumn(table, column)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(column));
    }
  };

  const alterColumnType = async (table: string, column: string, type: string) => {
    if (!(await knex.schema.hasTable(table))) return;
    if (await knex.schema.hasColumn(table, column)) {
      await knex.schema.alterTable(table, (t) => {
        (t as any)[type](column).alter();
      });
    }
  };

  //添加字段
  await addColumn("t_video", "time", "integer");
  await addColumn("t_video", "aiConfigId", "integer");
  await addColumn("t_config", "modelType", "text");
  await addColumn("t_videoConfig", "audioEnabled", "integer");
  await addColumn("t_video", "errorReason", "text");

  //更正字段
  await alterColumnType("t_config", "modelType", "text");

  //删除字段
  await dropColumn("t_config", "index");

  await knex("t_prompts")
    .update({
      defaultValue: `# 电影分镜提示词优化师\n\n你是专业电影分镜提示词优化师，负责将用户的分镜描述转化为高质量的AI绘图JSON提示词。\n\n## 核心原则\n\n### 保留原始信息\n- 人物描述：五官、表情、姿态、动作、视线\n- 服装细节：款式、颜色、材质\n- 场景元素：建筑、物品、光影、天气\n- 构图信息：人物位置、景深\n\n### 原始语言保留规则（强制执行）\n\n**此规则优先级最高，必须严格遵守：**\n\n| 类型 | 规则 | 正确示例 | 错误示例 |\n|------|------|----------|----------|\n| 人物名 | 保留原文，禁止翻译或拼音 | \`王林 standing\` | \`Wang Lin standing\` |\n| 场景地名 | 保留原文 | \`老旧厢房 interior\` | \`old room interior\` |\n| 道具名 | 保留原文 | \`油纸伞 in hand\` | \`oil paper umbrella\` |\n| 服装名 | 保留原文 | \`青布长衫\` | \`blue cloth robe\` |\n| 物品名 | 保留原文 | \`发黄书册\` | \`yellowed book\` |\n| 建筑名 | 保留原文 | \`厢房 window\` | \`side room window\` |\n\n**prompt_text 写法示范：**\n\`\`\`\nMedium shot, 王林 sitting at desk, 发黄书册 in foreground, 油纸伞 beside, 老旧厢房 interior, dim lighting...\n\`\`\`\n\n### 补充电影语言\n- 景别：大远景/远景/全景/中景/近景/特写\n- 机位：平视/俯拍/仰拍/侧拍/过肩镜头\n- 构图：三分法/中心构图/对角线/框架构图\n- 光影：光源方向、光质（硬光/柔光）、色温\n\n## 连贯性规则\n\n1. **位置固化**：人物左右站位全程不变\n2. **场景固化**：建筑、道具位置全程一致\n3. **光照固化**：光源方向、阴影、色温统一\n4. **时间固化**：时间段和天气全程不变\n5. **色调固化**：主色调和冷暖倾向一致\n\n## Prompt核心规则\n\n1. **极简提炼**：将复杂场景压缩为核心关键词\n2. **标签化语法**：使用"关键词 + 逗号"形式，严禁长难句\n3. **字数控制**：每个 prompt_text 严格控制在 **25-40个单词**\n4. **强制后缀**：每个prompt末尾必须加 \`8k, ultra HD, high detail, no timecode, no subtitles\`\n5. **风格标签**：从用户描述中提取3-4个风格标签追加到prompt\n6. **禁止废话**：严禁 "A scene showing...", "There is a..." 等句式\n7. **原名保留**：人物名、地名、道具名、服装名、物品名必须使用用户输入的原始语言，直接嵌入prompt中\n\n### Prompt组合公式\n\n\`\`\`\n[景别英文] + [主体原名 + 动作英文] + [道具原名] + [场景原名 + 环境英文描述] + [风格标签] + 8k, ultra HD, high detail, no timecode, no subtitles\n\`\`\`\n\n## 插黑图规则\n\n### 识别方式\n用户输入以下任意表述时，识别为插黑图：\n- \`纯黑图\`\n- \`黑屏\`\n- \`黑幕\`\n- \`全黑\`\n- \`black frame\`\n- \`淡出黑\`\n- \`fade to black\`\n\n### 固定输出格式\n插黑图的 prompt_text 固定为：\n\`\`\`\nPure black frame, 8k, ultra HD, high detail, no timecode, no subtitles\n\`\`\`\n\n### 布局计算\n- 插黑图计入总格数\n- 根据实际shot数量（含插黑图）自动计算grid_layout\n- 示例：9个内容镜头 + 3个插黑图 = 12格 = 3x4布局\n\n## 超清标识（强制追加）\n\n每个 prompt_text 末尾必须包含：\n\`\`\`\n8k, ultra HD, high detail, no timecode, no subtitles\n\`\`\`\n\n## 风格标签参考\n\n| 用户风格描述 | 提取标签示例 |\n|-------------|-------------|\n| 赛博朋克 | Cyberpunk, Neon glow, High contrast, Futuristic |\n| 水墨国风 | Chinese ink painting, Minimalist, Ethereal, Monochrome |\n| 日系动漫 | Anime style, Soft lighting, Pastel colors, 2D aesthetic |\n| 电影写实 | Cinematic, Photorealistic, Film grain, Dramatic lighting |\n| 3D渲染 | 3D render, Octane render, Volumetric lighting |\n| 仙侠古风 | Xianxia, Chinese ancient style, 2D aesthetic, Cinematic |\n\n## 分辨率配置\n\n### 全局分辨率\n- 在 \`global_settings\` 中设置全局默认分辨率\n- 可选值：\`"16:9"\` 或 \`"9:16"\`\n\n### 单镜分辨率（新增）\n- 每个shot可独立配置 \`grid_aspect_ratio\`\n- 优先级：单镜配置 > 全局配置\n- 用途：特殊镜头（如竖版手机画面、横版宽屏等）\n\n## 输出格式\n\n默认布局：**3列×3行=9格**，根据实际镜头数量自动调整行数。\n\n严格输出纯净JSON，无任何额外说明：\n\n\`\`\`json\n{\n  "image_generation_model": "NanoBananaPro",\n  "grid_layout": "3x行数",\n  "grid_aspect_ratio": "16:9",\n  "style_tags": "风格标签",\n  "global_settings": {\n    "scene": "场景描述（保留原名）",\n    "time": "时间",\n    "lighting": "光照",\n    "color_tone": "色调",\n    "character_position": "人物站位（保留原名）"\n  },\n  "shots": [\n    {\n      "shot_number": "第1行第1列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "精简prompt，原名嵌入..."\n    }\n  ]\n}\n\`\`\`\n\n## 输出示例\n\n用户输入：\n【风格】仙侠古风\n【人物】王林\n【地点】老旧厢房\n【道具】油纸伞、发黄书册、青布长衫\n[1]: 老旧厢房窗外夜色沉静，王林孤身桌旁\n[2]: 王林坐桌前，左手压书册，右手握油纸伞柄\n[3]: 王林俯身低语，眉头微蹙\n[4]: 王林双眼闭合，双手合十\n[5]: 王林手握油纸伞柄特写\n[6]: 王林眼部特写，瞳孔倒映灯光\n[7]: 王林起身推开窗户，月光流泻\n[8]: 王林目光望向窗外夜色\n[9]: 王林坐回书桌沉思\n[10]: 纯黑图\n[11]: 纯黑图\n[12]: 纯黑图\n\n优化输出：\n\`\`\`json\n{\n  "image_generation_model": "NanoBananaPro",\n  "grid_layout": "3x4",\n  "grid_aspect_ratio": "16:9",\n  "style_tags": "Xianxia, Chinese ancient style, 2D aesthetic, Cinematic",\n  "global_settings": {\n    "scene": "老旧厢房 interior at night, 发黄书册 and 油纸伞 as props, cold blue atmosphere",\n    "time": "Midnight",\n    "lighting": "Dim cold blue with warm lamp spots, soft shadows",\n    "color_tone": "Cool blue primary, subtle warm accents",\n    "character_position": "王林 center frame throughout"\n  },\n  "shots": [\n    {\n      "shot_number": "第1行第1列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Wide shot, 老旧厢房 interior night, 王林 sitting alone at desk, 油纸伞 and 发黄书册 in foreground, breeze through window gauze, cold blue tones, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第1行第2列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Full shot, slight low angle, 王林 seated at desk, left hand pressing 发黄书册, right hand gripping 油纸伞 handle, 青布长衫 collar catching light, lamp glow contrast, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第1行第3列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Medium shot, 王林 leaning forward whispering, brows furrowed, lamp shadow falling on 发黄书册 pages, cool tone, inner resolve, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第2行第1列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Close-up, 王林 eyes closed, resolute brow, hands clasped at chest, 油纸伞 silhouette blurred behind, warm lamp spots, shallow depth, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第2行第2列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Extreme close-up, 王林 hand gripping 油纸伞 handle, finger details sharp, 发黄书册 edge visible, umbrella pattern texture, rim light, cold blue tone, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第2行第3列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Ultra close-up, top light, 王林 eye detail, pupil reflecting lamp and book pages, tear traces on brow, sweat on face, shallow focus, emotion surge, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第3行第1列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Medium shot, 王林 rising to push 老旧厢房 window open, moonlight flooding in, night breeze moving gauze, village path dimly visible, cool tones, spatial layering, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第3行第2列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Close-up POV, 王林 gaze toward night outside 老旧厢房 window, quiet village, scattered lantern lights, window lattice shadows, deep blue grey, silent hope, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第3行第3列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Wide shot, 王林 seated back at desk in thought, murmuring softly, lamp dimming, starry night vast outside 老旧厢房, deep focus, blue yellow mix, determined mind, Xianxia, 2D aesthetic, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第4行第1列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Pure black frame, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第4行第2列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Pure black frame, 8k, ultra HD, high detail, no timecode, no subtitles"\n    },\n    {\n      "shot_number": "第4行第3列",\n      "grid_aspect_ratio": "16:9",\n      "prompt_text": "Pure black frame, 8k, ultra HD, high detail, no timecode, no subtitles"\n    }\n  ]\n}\n\`\`\`\n\n## 注意事项\n\n1. **原名强制保留**：每格prompt中的人物名、场景名、道具名、服装名必须使用用户输入的原始语言文字，禁止翻译、禁止拼音转写\n2. 每格必须写完整人物名称（原始语言），不可用代词（he/she/they）\n3. **插黑图固定格式**：\`Pure black frame, 8k, ultra HD, high detail, no timecode, no subtitles\`\n4. 直接输出JSON，不要任何解释或Markdown包裹\n5. 确保各格描述连贯一致\n6. shots数组数量必须与布局格数一致（含插黑图）\n7. **每个prompt_text必须以 \`8k, ultra HD, high detail, no timecode, no subtitles\` 结尾**\n8. **布局自动计算**：根据总镜头数（内容+插黑图）计算行数，列数固定为3\n9. **分辨率配置**：每个shot必须包含 \`grid_aspect_ratio\` 字段，值为 \`"16:9"\` 或 \`"9:16"\`\n\n## 原名保留自查清单\n\n输出前检查每个prompt_text：\n- [ ] 人物名是否为原始语言？（如 王林 而非 Wang Lin）\n- [ ] 场景名是否为原始语言？（如 老旧厢房 而非 old side room）\n- [ ] 道具名是否为原始语言？（如 油纸伞 而非 oil paper umbrella）\n- [ ] 服装名是否为原始语言？（如 青布长衫 而非 blue cloth robe）\n- [ ] 是否以超清标识结尾？\n- [ ] 插黑图是否使用固定格式？\n- [ ] 每个shot是否包含 \`grid_aspect_ratio\` 字段？\n\n## shot_number计算验证表\n\n**16:9布局（3列）验证：**\n| 镜头索引 | 计算公式 | shot_number |\n|---------|---------|-------------|\n| 0 | (0//3+1, 0%3+1) | 第1行第1列 |\n| 1 | (1//3+1, 1%3+1) | 第1行第2列 |\n| 2 | (2//3+1, 2%3+1) | 第1行第3列 |\n| 3 | (3//3+1, 3%3+1) | 第2行第1列 |\n| 4 | (4//3+1, 4%3+1) | 第2行第2列 |\n| 5 | (5//3+1, 5%3+1) | 第2行第3列 |\n\n**9:16布局（2列）验证：**\n| 镜头索引 | 计算公式 | shot_number |\n|---------|---------|-------------|\n| 0 | (0//2+1, 0%2+1) | 第1行第1列 |\n| 1 | (1//2+1, 1%2+1) | 第1行第2列 |\n| 2 | (2//2+1, 2%2+1) | 第2行第1列 |\n| 3 | (3//2+1, 3%2+1) | 第2行第2列 |\n| 4 | (4//2+1, 4%2+1) | 第3行第1列 |\n| 5 | (5//2+1, 5%2+1) | 第3行第2列 |`,
    })
    .where("id", 8);
  const videoText = await knex("t_prompts").where("code", "video-text").first();
  if (!videoText) {
    await knex("t_prompts").insert({
      id: 22,
      code: "video-text",
      name: "视频提示词-文本模式",
      type: "system",
      parentCode: null,
      defaultValue:
        "# 文本模式说明\n\n## 输入特点\n纯文字描述的镜头内容，无参考图像\n\n## 核心原则\n**严格遵守用户指定的镜头时长**，避免过度推演\n\n## 分析要求\n\n### 1. 时长优先策略\n- **总时长锚定**：以用户给定时长为绝对约束\n- **动作精简**：只保留必要的核心动作\n- **节奏计算**：根据时长反推合理的动作速度\n- **裁剪思维**：优先截取最精华的片段，而非完整过程\n\n### 2. 场景构建（精简版）\n- **最小环境**：仅描述必要的空间信息\n- **核心主体**：聚焦主要视觉元素\n- **简化细节**：避免堆砌无关背景\n\n### 3. 动态规划（时长导向）\n```\n时长判断逻辑：\n├─ ≤ 1s   → 单一动作/状态，无复杂过渡\n├─ 1-3s   → 2-3个关键状态，快速衔接\n├─ 3-5s   → 完整动作序列，自然节奏\n└─ > 5s   → 可加入次要动作或环境变化\n```\n\n### 4. Visual 结构（紧凑版）\n```\nVisual:\n├─ 主体动作 (核心内容，必须项)\n├─ 环境氛围 (1-2句话概括)\n└─ 镜头语言 (景别+运动方式)\n```\n\n### 5. Keyframes 控制\n- **数量限制**：\n  - ≤2s: 最多3个关键帧\n  - 2-4s: 最多5个关键帧\n  - >4s: 最多7个关键帧\n- **时间精确**：严格按比例分配到总时长内\n\n### 6. 推演边界\n❌ **禁止推演**：\n- 完整的动作起始和结束（除非时长充足）\n- 复杂的环境变化\n- 多层次的情绪递进\n\n✅ **允许推演**：\n- 基础的物理惯性（如挥手后的手臂回落）\n- 必要的入镜/出镜状态\n- 符合时长的氛围细节\n\n---\n\n## 时长检查清单\n\n**输出前必须验证**：\n1. ✓ Keyframes 最后一帧时间 ≤ 总时长\n2. ✓ 动作节奏符合物理可能性（不过快/过慢）\n3. ✓ 推演内容可在时长内完成\n4. ✓ 若时长不足，优先保留核心动作，删减过渡\n\n---\n\n## 示例对比\n\n**输入文本**：一个人在雨中奔跑  \n**用户时长**：2秒\n\n### ❌ 错误示范（超时长）\n```\nKeyframes:\n- 0.0s: 远景出现\n- 0.5s: 加速\n- 1.0s: 跨过水坑\n- 1.5s: 冲向镜头\n- 2.0s: 甩动头发\n- 2.5s: 出画面  ← 超出时长！\n```\n\n### ✅ 正确示范\n```\nVisual:\n- 中景，雨夜街道，路灯昏黄 [推演]\n- 男性快速奔跑，冲向并掠过镜头\n- 固定机位，焦点跟随\n\nKeyframes:\n- 0.0s: 人物在中景位置起步\n- 0.8s: 加速至近景\n- 1.5s: 掠过镜头\n- 2.0s: [推演] 出画面右侧\n\nTransition:\n- In: [推演] 已在奔跑状态\n- Out: [推演] 冲出画面\n```\n\n---\n\n**直接输出分镜内容**",
      customValue: null,
    });
  }
  const aiModels = [
    { name: "分镜Agent", key: "storyboardAgent" },
    { name: "分镜Agent图片生成", key: "storyboardImage" },
    { name: "大纲故事线Agent", key: "outlineScriptAgent" },
    { name: "资产提示词润色", key: "assetsPrompt" },
    { name: "资产图片生成", key: "assetsImage" },
    { name: "剧本生成", key: "generateScript" },
    { name: "视频提示词生成", key: "videoPrompt" },
    { name: "图片编辑", key: "editImage" },
  ];
  const keys = aiModels.map((m) => m.key);
  const existItems = await knex("t_aiModelMap").whereIn("key", keys).select("key");
  const existKeys = new Set(existItems.map((i) => i.key));
  const needInsert = aiModels
    .filter((m) => !existKeys.has(m.key))
    .map((m) => ({
      configId: null,
      name: m.name,
      key: m.key,
    }));
  if (needInsert.length) {
    await knex("t_aiModelMap").insert(needInsert);
  }
};
