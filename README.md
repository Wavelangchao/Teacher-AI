# Teacher AI

数学教师课后反馈生成系统。它适合培训机构、家教老师或教研团队在课后快速整理家长反馈：填写学生情况、授课内容、课堂表现和作业安排后，系统调用通义千问生成一段可直接发送给家长的中文反馈，并把历史记录保存到本地 SQLite 数据库。

这个项目不是聊天机器人，而是一个围绕「课后反馈」做过约束的小工具。它内置了数学课堂常见评价维度、年级知识范围限制、历史档案、Token 统计和系统诊断，部署后打开浏览器就能用。

## 主要功能

- **课后反馈生成**：根据学生姓名、年级、水平等级、授课内容、课堂表现和作业安排生成反馈文案。
- **流式输出**：使用 SSE 边生成边显示，不用等完整响应结束。
- **一对一 / 班课模式**：支持单个学生，也支持小班课、大班课批量生成多位学生反馈。
- **课堂评价维度**：内置作业完成、听课状态、课堂互动、随堂练习、基础知识、公式掌握、做题速度、解题思路、计算能力、学习习惯、进步趋势等维度。
- **年级约束**：可选择小学、初中、高中年级，生成建议时尽量避免推荐超纲方法。
- **历史记录**：自动保存反馈内容，支持搜索、查看详情、删除和批量删除。
- **学生档案**：按学生聚合历史反馈，查看反馈次数、最近反馈、Token 消耗和趋势状态。
- **系统设置**：在页面中保存通义千问 API Key，切换模型、Temperature 和最大输出长度。
- **系统诊断**：检查 PHP 扩展、数据库权限、网络连通性、API Key 和模型可用性。
- **数据导出**：支持导出 CSV，方便备份或后续整理。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 前端 | HTML、CSS、原生 JavaScript |
| 后端 | PHP |
| 数据库 | SQLite |
| AI 服务 | 阿里云百炼 / 通义千问 |
| 接口形式 | OpenAI 兼容 Chat Completions、Server-Sent Events |

## 目录结构

```text
Teacher-AI/
├── index.html          # 前端页面
├── api.php             # 后端 API 入口
├── config.php          # 模型、Prompt、日志等公共配置
├── database.php        # SQLite 初始化和表结构
├── css/
│   └── style.css
├── js/
│   ├── dimensions.js   # 评价维度数据
│   ├── utils.js        # 前端工具函数
│   └── main.js         # 页面交互和业务逻辑
├── CHANGELOG.md
├── LICENSE
└── README.md
```

`data/` 目录不会提交到仓库。项目运行时会自动创建：

```text
data/
├── feedback.db         # SQLite 数据库
└── logs/               # 操作日志和错误日志
```

如果服务器禁止 PHP 写入项目目录，请手动创建 `data/` 并给 PHP 进程写权限。

## 环境要求

- PHP 8.0 或更高版本
- PHP 扩展：`sqlite3`、`curl`、`openssl`、`json`、`mbstring`
- 服务器能访问 `https://dashscope.aliyuncs.com`
- 一个可用的阿里云百炼 API Key

## 本地运行

```bash
git clone https://github.com/Wavelangchao/Teacher-AI.git
cd Teacher-AI
php -S 127.0.0.1:8000
```

浏览器打开：

```text
http://127.0.0.1:8000/index.html
```

第一次使用时，进入右上角「系统设置」，填写阿里云百炼 API Key，选择模型并保存。然后回到主页面填写学生信息和授课内容，点击生成。

## 线上部署

把项目上传到支持 PHP + SQLite 的服务器即可，例如宝塔面板、Apache、Nginx + PHP-FPM 或常规虚拟主机。

部署后建议按这个顺序检查：

1. 确认 `data/` 目录可写。没有这个目录时程序会尝试自动创建。
2. 确认服务器启用了 `sqlite3`、`curl`、`openssl`、`json`、`mbstring`。
3. 打开页面右上角「系统诊断」，查看数据库、网络和 API 状态。
4. 在「系统设置」中保存 API Key。
5. 测试生成一条反馈，再到「历史记录」确认保存正常。

Nginx 建议禁止直接访问运行时数据目录：

```nginx
location ^~ /data/ {
    deny all;
}
```

Apache 环境下，程序会尝试在 `data/` 目录写入 `.htaccess`。保险起见，仍建议在服务器面板或站点配置里确认 `data/` 不可被公网直接下载。

## 基本使用流程

1. 选择教学场景：一对一、小班课、大班课、线上课、考前复习等。
2. 填写学生姓名、水平等级和年级。
3. 选择课堂表现评价维度，也可以套用快捷预设。
4. 填写授课内容、作业和补充说明。
5. 选择反馈日期和字数范围。
6. 点击生成，等待流式输出完成。
7. 复制、分享，或进入历史记录/学生档案查看过往内容。

## 通义千问模型

当前配置里包含这些模型选项：

- `qwen-turbo`
- `qwen-plus`
- `qwen-max`
- `qwen-long`
- `qwen-plus-latest`
- `qwen-max-latest`
- `qwen3.6-flash`
- `qwen3.7-plus`

不同账号的模型权限可能不一样。如果保存配置后生成失败，可以先用「系统诊断」或「测试全部模型」确认当前 API Key 能访问哪些模型。

## API 概览

后端入口统一为 `api.php`，通过 `action` 参数区分操作。

| Action | 说明 |
| --- | --- |
| `save_config` | 保存 API Key、模型和生成参数 |
| `get_config` | 读取当前配置，API Key 只返回掩码 |
| `delete_config` | 清除已保存的 API 配置 |
| `stream_feedback` | 单个学生流式生成反馈 |
| `stream_feedback_batch` | 多学生批量流式生成反馈 |
| `get_history` | 获取历史记录或单条详情 |
| `delete_history` | 删除单条历史记录 |
| `delete_history_batch` | 批量删除历史记录 |
| `student_profile` | 获取学生档案聚合数据 |
| `diagnose` | 获取系统诊断信息 |
| `verify_key` | 验证当前 API Key |
| `token_stats` | 查看 Token 使用统计 |
| `quota_info` | 查看本地用量和配额相关信息 |
| `test_model` | 测试当前模型 |
| `test_all_models` | 批量测试模型可用性 |
| `export_data` | 导出反馈数据 |

## 数据和安全

- `data/` 已在 `.gitignore` 中忽略，不会上传到 GitHub。
- `data/feedback.db` 可能包含学生姓名、反馈内容和 API 配置，不要公开。
- `data/logs/` 可能包含错误上下文和服务器路径，不要公开。
- API Key 会加密后存入 SQLite，但仍建议把站点部署在可信服务器上。
- 当前版本不包含登录系统。如果要放到公网并限制访问，建议在 Nginx、Apache、宝塔访问控制、Cloudflare Access 或后端登录层做正式鉴权。
- 公开演示站点不要使用真实学生姓名和真实课堂数据。

## 发布前检查

提交到 GitHub 前建议确认：

```bash
git status --short --ignored
```

看到类似下面的输出说明 `data/` 已被忽略：

```text
!! data/
```

正常应提交的文件包括：

```text
index.html
api.php
config.php
database.php
css/
js/
README.md
CHANGELOG.md
LICENSE
.gitignore
```

不要提交：

```text
data/
*.db
*.db-wal
*.db-shm
*.log
```

## 常见问题

### `data/` 会自动创建吗？

会。`database.php` 会在首次访问时尝试创建 `data/` 和 `feedback.db`。如果创建失败，通常是 PHP 没有目录写入权限。

### 生成失败或请求超时怎么办？

先打开「系统诊断」。重点看 `curl`、DNS、443 端口连通性、API Key 和模型权限。班课人数较多时，可以减少单次学生数量，或切换到响应更快的模型。

### API Key 明明填了，为什么还是不可用？

检查 Key 是否以 `sk-` 开头，并确认阿里云百炼控制台已开通对应模型。部分模型需要单独开通权限。

### 历史记录没有保存？

检查 `data/` 是否可写。SQLite 数据库无法创建或无法写入时，历史记录就不能保存。

### 页面更新后没变化？

浏览器可能缓存了旧的 CSS/JS。可以点击页面底部「强制刷新」，或者清理浏览器缓存后重开页面。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。
