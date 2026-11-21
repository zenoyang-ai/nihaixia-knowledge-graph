# 天纪提示词（Agent Skill）

把倪海厦《天纪》（天机道、人间道、地脉道）的思路整理成一套可直接安装给 AI 助手的提示词，覆盖五个常见场景：八字校盘、大运流年、紫微斗数命盘解读、易经三才拆问题、小六壬看日常小事。

> 所有分析仅供学习和思维参考，不构成医疗、投资、婚姻等重大决策的依据。

## 安装

支持 Claude Code、Cursor、Codex、Antigravity 等工具，在终端跑一行就行：

```bash
npx skills add zenoyang-ai/nihaixia-knowledge-graph --skill nihaixia-tianji
```

如果你用 Codex 内置的 Python 安装脚本：

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo zenoyang-ai/nihaixia-knowledge-graph \
  --path skills/nihaixia-tianji
```

## 装好后怎么用

直接把你的问题或排盘数据发给 AI，它会自动匹配对应流程：

```text
用倪海厦天纪帮我做一次八字校盘（附四柱）
我有一张紫微斗数命盘，帮我按宫位和星曜拆解一下
用易经三才帮我分析一下要不要换这份工作
按现在时间用小六壬看看今天去谈合作顺不顺
```

## 里面有什么

| 文件 | 说明 |
| --- | --- |
| [SKILL.md](./SKILL.md) | 触发条件、路由规则、执行步骤与输出边界 |
| [references/prompts.md](./references/prompts.md) | 八字基础、八字大运、紫微斗数、易经三才 4 套完整提示词 |
| [references/xiaoliuren.md](./references/xiaoliuren.md) | 小六壬起课算法、时辰换算表与六神速查表 |
| [agents/openai.yaml](./agents/openai.yaml) | 客户端名称与默认提示配置 |

---

配套网页版：[在线天纪提示词](https://www.nihaixia-knowledge.xyz/#/prompts) · 开源资料总目录：[knowledge/README.md](../../knowledge/README.md)
