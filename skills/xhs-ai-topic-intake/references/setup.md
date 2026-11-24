# 本地配置

复制本目录 `target.example.json` 为 `target.local.json`，填写自己的 `base_token` 与 `topic_table_id`。也可通过 `XHS_TOPIC_CONFIG` 环境变量指定配置文件。示例坐标不能调用远端。

本地配置只放目标坐标，不放密钥。凭据交给官方 lark-cli 管理；先按其官方说明安装、授权，并确认可用的 `base +record-list`、`+record-batch-create`、`+record-batch-update` 命令。Skill 不自动申请广泛权限。

目标表应有：

| 字段 | 类型 / 选项 |
| --- | --- |
| 选题名称 | 文本 |
| 参考笔记 | 文本，可存 Markdown 链接 |
| 合集 | 单选：vibe Coding、驯服 GPT、Skill |
| 选题方向 | 单选：干货合集、成长记录 |
| 制作时机 | 单选：待判断、现在可做、需补知识、暂缓 |

字段可改名，修改配置 `fields` 的值即可，内部键保持不变。新增前核对字段和选项；此脚本不创建表格、不迁移旧表、不修改 schema。

在任务工作目录运行脚本；`work/` 是相对于当前目录的产物目录。输出文件名必须唯一。单次最多 30 个选题；快照超过单页 2000 条会停止，不把局部结果当完整库。

测试使用示例配置，不依赖真实飞书数据。Windows 可自动定位默认 npm 安装的 lark-cli Node 入口；其他安装位置通过 `LARK_CLI_ENTRY` 指定，或确保 `lark-cli` 在 PATH。
