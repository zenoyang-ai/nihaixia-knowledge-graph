# 天纪提示词 Agent Skill（`nihaixia-tianji`）

基于倪海厦《天纪》（天机道、人间道、地脉道）框架的现代化转译 Agent Skill，覆盖**八字校盘、大运流年、紫微斗数命盘解读、易经三才现实问题拆解、小六壬日常快断** 5 类场景。

> **使用边界**：本 Skill 所有分析仅供学习与思维框架参考，不构成医疗、投资、婚姻等重大决策的唯一依据。

## 一行命令安装

支持 **Claude Code / Cursor / Codex / Antigravity** 等主流 Agent 客户端：

```bash
npx skills add zenoyang-ai/nihaixia-knowledge-graph --skill nihaixia-tianji
```

如果你使用 Codex 内置 Python 安装脚本：

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo zenoyang-ai/nihaixia-knowledge-graph \
  --path skills/nihaixia-tianji
```

## 目录说明

| 文件 | 作用 |
|------|------|
| [SKILL.md](./SKILL.md) | Agent 触发条件、路由规则、执行流程与输出边界主文件 |
| [references/prompts.md](./references/prompts.md) | 八字基础、八字大运、紫微斗数、易经三才 4 套完整提示词 |
| [references/xiaoliuren.md](./references/xiaoliuren.md) | 小六壬起课算法、时辰换算表与六神速查表 |
| [agents/openai.yaml](./agents/openai.yaml) | 客户端展示元数据（名称、简介与默认提示） |

> 配套在线网页版：[倪海厦知识图谱 · 天纪提示词](https://www.nihaixia-knowledge.xyz/#/prompts) ｜ 仓库开源知识库总览：[knowledge/README.md](../../knowledge/README.md)
