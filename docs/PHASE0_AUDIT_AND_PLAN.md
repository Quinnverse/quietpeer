# Phase 0 — P2P 加密聊天室只读审计与实施计划

作者：Manus AI  
日期：2026-10-22  
范围：READ-ONLY AUDIT & IMPLEMENTATION PLAN。本文是独立交付报告，不是功能实现、安全认证或已执行测试报告。

## 01_REQUIREMENTS

### 材料与审计结果

已完整阅读本轮附件 `1-pasted_content_3.txt`，共 301 行。它提供了本轮工作要求、题目目标的转述和验收维度；没有独立的官方题目原文、评分细则或提交入口。本文所称“明确要求”指本轮提供的材料，不把技术选择冒充官方考试要求。

只读检查结果如下。

| 材料 | 实际发现 | 结论 |
|---|---|---|
| 当前工作区 | `/Users/zhangqiyun/Documents/Manus/2026-10-22/9zApTs` 为空，无仓库、源文件或根目录 AGENTS.md | `SOURCE_NOT_PROVIDED` |
| 项目共享材料 | 共享文件目录为空，项目说明为空，共享链接为空 | 未发现额外题目、源码或交付说明 |
| README、接口与模型 | 未提供 | 无法审计现有实现 |
| package.json、锁文件、构建和测试配置 | 未提供 | 依赖版本与可运行性未知 |
| 官方交付要求 | 无独立材料或链接 | `SUBMISSION_REQUIREMENTS_UNKNOWN` |
| 运行及安全测试 | 未安装、启动、构建或执行测试 | 全部 `NOT_TESTED` |

没有把相邻任务目录当成本项目仓库，也没有扫描无关个人目录。此结论仅表示当前提供及定位到的材料中没有源码，不表示电脑其他位置绝不存在项目。

**操作边界说明：**未改动项目文件，未安装或升级依赖，未运行构建、测试、Git 修改、部署或发布，未调用生产密钥或真实用户数据。项目配置检查工具生成了工具管理的临时配置快照；这是产生本地临时文件的操作，不能描述为“整个过程零文件写入”。发现这一行为后不再执行可能产生缓存的检查命令。除此之外，仅按本轮允许的例外保存本报告至独立 `phase0-deliverables` 目录。后续实现未开始。

### 最终作品与要求分类

| 要求或选择 | 标记 | 完成标准 |
|---|---|---|
| 建立连接、收发消息的 P2P 加密聊天室 | `EXPLICIT_REQUIRED` | 两个独立客户端真实连接，A→B 和 B→A 均可通信 |
| 尽可能防止聊天数据泄漏 | `EXPLICIT_REQUIRED` | 明确保护边界；正文加密；身份、完整性、重放、本地数据和日志风险有设计及验证证据 |
| 两个独立浏览器实例、无正式账号、直观邀请加入 | `EXPLICIT_REQUIRED` | 创建方邀请，加入方进入同一会话，不依赖注册体系 |
| 身份验证或身份变化告警、安全与消息状态、异常处理 | `EXPLICIT_REQUIRED` | 不静默接受身份替换，不把连接或送达状态显示得比实际更安全 |
| 中间服务不能读取聊天正文 | `EXPLICIT_REQUIRED` | 在可信客户端和已验证端点的边界下，信令及普通中继没有正文或解密密钥 |
| 可重复安全测试和完整本地启动说明 | `EXPLICIT_REQUIRED` | 明确测试步骤、环境、结果与限制，新目录可复现 |
| 浏览器原生 WebRTC DataChannel + 信令服务器 | `DESIGN_DECISION` | 单一可靠有序数据通道；服务器仅传递连接信息 |
| 双向全长 SHA-256 指纹带外比对 | `DESIGN_DECISION` | 比对实际连接绑定的证书指纹；完成前禁止处理聊天正文 |
| 内存聊天、临时会话证书、刷新结束会话 | `DESIGN_DECISION` | 不持久化正文、密钥或验证状态；新会话重新验证 |
| TURN 网络穿透支持 | `DESIGN_DECISION`，取决于验收网络 | 跨受限 NAT 的通用网络验收需要；同机双浏览器演示可先不依赖它 |
| 源码提交形式、压缩包命名、托管地址和截止时间 | `UNKNOWN` | 等待官方交付说明 |
| README.md、SECURITY.md、锁文件、测试报告 | `DESIGN_DECISION` | 推荐作为完整可复现交付组成；不能声称官方指定了这些文件名 |
| 演示视频、截图 | `OPTIONAL`；考试是否必需为 `UNKNOWN` | 可辅助展示，但不能代替实际运行与安全测试 |

**完成：**MVP 核心能力真实运行，关键负向测试取得结果，新目录能启动，并且说明与 UI 不超出实际保护范围。正式提交是否完整，仍须以官方规则为准。

**部分完成：**只有 UI；只有单页模拟双方；只有传输连接而没有身份验证；只有 Mock；正文经过可解密服务器；或新环境无法复现。未验证模式不能作为安全聊天的已完成交付。

建议后续交付：完整源码和依赖锁文件、README.md、SECURITY.md、可执行测试及夹具、`docs/TEST_REPORT.md` 和脱敏验收证据。`.env.example` 仅列配置项，不包含真实密钥。不得打包聊天记录、浏览器配置目录、私钥、生产凭据、node_modules 或调试转储。

## 02_FUNCTION_CHECKLIST

优先级：P0 为 MVP 阻塞项，P1 为网络适配或交付强化。复杂度为相对评估，不是现有实现的测量。

| 功能 | 描述 | 优先级 | 复杂度 | 依赖 | 可验证验收条件 | MVP |
|---|---|---|---|---|---|---|
| 创建会话 | 建立内存态两人会话及邀请凭据 | P0 | 低 | 运行基线 | 邀请有效期、人数上限和结束行为明确 | 是 |
| 邀请与加入 | 复制邀请链接，另一个浏览器加入 | P0 | 中 | 会话、信令 | 两实例加入同房间；失效邀请和第三人被拒绝 | 是 |
| 真实双端连接 | SDP/ICE 交换及 DataChannel 建立 | P0 | 高 | 浏览器能力、信令 | 独立浏览器形成真实 PeerConnection，非 UI Mock | 是 |
| 浏览器端到端加密 | SCTP 负载由端点间 DTLS 保护 | P0 | 中 | WebRTC | 中间服务没有正文和 DTLS 私钥；无明文回退 | 是 |
| 身份验证 | 双向带外比对实际证书全长指纹 | P0 | 高 | 临时证书、实际 SDP | 不匹配或未验证均拒绝正文；验证绑定当前连接 | 是 |
| 身份变化处理 | 连接、证书或会话变化撤销验证 | P0 | 中 | 验证绑定、状态机 | 旧绿色状态不能继承至新连接 | 是 |
| 双向纯文本聊天 | 输入、发送、接收和安全显示 | P0 | 中 | 验证门控、通道 | A/B 双向及并发多条消息，每条只展示一次 | 是 |
| 消息状态 | 区分待发、已入发送缓冲、已送达、未知、失败 | P0 | 中 | ACK、超时、去重 | 只有有效 ACK 才显示已送达；不宣称已读 | 是 |
| 完整性与重放防护 | DTLS 认证；业务序号、ID 和 epoch 校验 | P0 | 中 | 通道、封装 | 密文篡改不产生篡改后的正文；旧会话帧被拒绝 | 是 |
| 网络异常处理 | 中断时暂停发送；恢复或明确失败 | P0 | 高 | 连接事件、超时 | 断网显示真实不确定性；不默默切换正文中继 | 是 |
| 内存与日志治理 | 不持久化聊天密钥；诊断白名单 | P0 | 中 | 生命周期、日志策略 | 存储及日志检查没有正文、私钥或邀请令牌 | 是 |
| XSS 防护 | 所有聊天输入按纯文本处理 | P0 | 中 | UI、依赖与 CSP | 脚本样式输入不执行、不触发外发 | 是 |
| 安全状态界面 | 分开表达连接、加密与身份验证 | P0 | 中 | 独立状态字段 | “通道加密但身份未验证”不会显示“安全身份已验证” | 是 |
| 全新目录复现 | 文档、配置、锁版本和可执行测试 | P0 | 中 | 所有基础模块 | 按 README 安装启动，双端及关键负向测试可复现 | 是 |
| TURN 适配 | 在直连失败时使用原生加密中继 | P1 | 中至高 | 可用 TURN 环境 | 强制 relay 时仍为浏览器端点 DTLS，证据标注 relay | 条件项 |

## 03_FILE_INTERFACE_MAP

**下表所有路径和接口均为 `PROPOSED`，不是现有文件或已实现 API。**由于无源码，不能给出真实修改清单；若 Owner 后续提供项目，应先重新映射并保留既有接口。

| 功能 | 现有文件 | 现有接口 | 需要新增或修改的文件：PROPOSED | 验收方式 |
|---|---|---|---|---|
| 项目基线 | `SOURCE_NOT_PROVIDED` | 未知 | package.json、锁文件、tsconfig.json、vite.config.ts、index.html | 全新目录安装、启动与构建 |
| 创建/加入 | 同上 | 未知 | src/ui/SessionPanel.tsx、src/session/session.ts、server/rooms.ts | 两浏览器、过期邀请、人数上限 |
| 信令 | 同上 | 未知 | src/network/signaling.ts、server/index.ts、shared/signaling.ts | 严格 schema、SDP/ICE 路由、断连清理 |
| WebRTC | 同上 | 未知 | src/network/peerConnection.ts | 真实 DataChannel、连接超时、身份绑定 |
| 临时证书和指纹 | 同上 | 未知 | src/security/certificate.ts、src/security/fingerprint.ts | 来源绑定、SHA-256 格式、缺失/替换测试 |
| 验证门控 | 同上 | 未知 | src/security/verification.ts、src/ui/VerificationPanel.tsx | UI 与底层发送/接收同时阻断 |
| 消息协议 | 同上 | 未知 | shared/messages.ts、src/chat/messageProtocol.ts | epoch、角色、序号、ID、ACK 及尺寸检查 |
| 状态与 UI | 同上 | 未知 | src/session/state.ts、src/ui/ChatPanel.tsx、src/ui/SecurityStatus.tsx | 状态转换、并发与送达未知 |
| 隐私与日志 | 同上 | 未知 | src/security/privacy.ts、shared/safeLogger.ts | 生命周期、存储和日志审计 |
| 测试 | 同上 | 未知 | tests/unit/*、tests/integration/*、tests/e2e/*、playwright.config.ts | 单测、真实浏览器、受控攻击夹具 |
| 交付 | 同上 | 未知 | README.md、SECURITY.md、.env.example、docs/TEST_REPORT.md | 启动复现与边界说明 |
| TURN 配置 | 同上 | 未知 | docs/TURN.md、独立测试环境配置 | 强制 relay、服务端可见数据检查 |

拟议信令接口为一个 `/signal` WebSocket 入口，消息类别限定为 create、join、offer、answer、candidate、leave、error，及可选 restart-request。公共字段含协议版本、会话标识、请求标识和类别对应载荷。具体名称要在 R0 冻结，当前不是约定好的现有接口。

服务器根据已绑定的 socket 与房间角色决定转发对象，不信任客户端自报发送者；禁止任意房间广播、第三人加入和聊天正文类型。设置连接、帧长度、频率、房间 TTL 和 Origin 白名单。Origin 检查不是完整身份认证，邀请令牌只是加入能力，不是端点身份凭据。服务端不长期保存 SDP/ICE，不输出其原文日志。

拟议客户端逻辑边界为 createSession、joinSession、applyRemoteDescription、verifyFingerprintBinding、sendText、receiveFrame 和 endSession。它们均是职责规划，而非现存函数。

## 04_DATA_AND_STATE_FLOW

### 数据结构

| 结构 | PROPOSED 字段 | 含义与安全约束 |
|---|---|---|
| PeerIdentity | role、certificateHandle、localFingerprint、remoteFingerprint | 身份是本次会话 DTLS 密钥端点，不是账号；本地证书句柄只留内存，不导出私钥 |
| PeerSession | sessionId、epoch、pcInstanceId、fixedRole、channelHandle、verificationBinding、pendingMessages、receiveState | 验证记录绑定实例、epoch、双方指纹和角色，不能由信令或 control 直接设置 |
| ConnectionState | idle、waiting-peer、signaling、connecting、connected、interrupted、recovering、failed、closed | connected 不自动代表身份已验证或正文可发送 |
| EncryptionState | unavailable、negotiating、transport-protected、failed、ended | 仅通道真实建立后称传输加密已建立；应用不自行产生加密密钥 |
| KeyVerificationState | unverified、pending、verified、mismatch、revoked | full SHA-256 指纹比对、通道及绑定满足条件后 verified；不匹配直接停止 |
| MessageEnvelope | version、epoch、senderRole、seq、messageId、type，以及 body 或 ackFor | type 为 text、ack；可选 control 仅用于关闭等有限控制，不承载“验证通过”或换钥权限 |
| MessageDeliveryState | queued、buffered、delivered、unknown、failed | buffered 只表示本地 send 接受；delivered 要匹配有效 ACK；unknown 不能推断未送达 |

序号按发送方向分别递增，以规范十进制字符串表示 uint64，读取时做 BigInt 范围校验，不能依赖 JavaScript Number 精确表示大整数。messageId 建议使用浏览器安全随机源生成至少 128 位 ID。会话 epoch 采用创建端生成的高熵新会话标签，建立后在同一实际通道绑定；它不是认证凭据，安全性不依赖信令服务器诚实选择标签。

首版单一可靠有序通道，每端维护对端高水位和已处理消息记录。对已知完全相同的重复帧，允许返回同一收取 ACK，但不得再次显示或执行；未知倒退序号、同 ID 不同内容、错角色或旧 epoch 均拒绝。去重状态不应在同一会话中悄悄清空；设置明确的会话消息数量和内存上限，到上限结束会话或要求新建，避免无限增长。首版不增加应用层自动重传，SCTP 已提供通道内可靠传输。

**消息封装不是另一个密码协议。**应用 JSON 在端点内包含正文，交给 DataChannel 后由浏览器 DTLS 加密认证；应用不会得到一个可转发到任意 WSS 的“密文对象”。因此不得把 `body` 称为应用层 ciphertext，也不得让同一 JSON 经信令服务器传输。[1] [2]

### 状态门控

正文发送和接收必须同时满足：当前 DataChannel 为 open；传输保护已建立；本地完成可信带外双向比对；验证记录仍精确绑定当前实例、epoch 和指纹。UI 禁用按钮之外，底层 sendText 和入站处理也要拒绝绕过。

未验证时收到 text 或 ack，直接丢弃，不渲染、不缓存、不补投递、不回 ACK。会话元数据的有限握手只用于一致性检查，不可以提升身份状态。用户必须真正核对双方指纹，不能以“双方都点了按钮”替代核对，也不能用当前未认证聊天交换验证码完成验证。

### 十步会话流程

| 步骤 | 输入 | 输出及动作 | 失败状态 | 信任边界 |
|---|---|---|---|---|
| 1 创建会话 | 用户明确创建动作 | 新证书、新 PC、新 epoch、内存房间 | 能力不支持、随机源/证书失败 | 浏览器及可信客户端代码生成证书；服务器不生成私钥 |
| 2 邀请另一用户 | 房间加入凭据 | 可复制邀请链接、等待加入 | 过期、人数满、链接无效 | 邀请可经外部渠道泄漏；它不认证对方身份 |
| 3 交换连接信息 | A offer、B answer、ICE | 严格校验后应用到指定 PC | SDP 错误、旧协商代、角色错、超时 | 信令不可信，可替换连接信息或阻断 |
| 4 建立安全连接 | 已应用 SDP、ICE 检查 | 浏览器 DTLS 握手及 SCTP/DataChannel open | ICE/DTLS 失败、证书不匹配 | 浏览器校验实际 DTLS 证书匹配 SDP；仍未证明对端是预期的人 |
| 5 验证通信身份 | 本地实际指纹、对端已应用 SDP 指纹、可信带外信息 | 双向核对后建立本地验证绑定 | 指纹不同、来源不明、用户拒绝 | 带外渠道必须独立可信；同一信令提供的自报值不能认证 |
| 6 发送加密消息 | verified 状态、纯文本 | Envelope 交给 DataChannel，由 DTLS 加密；状态 buffered | 未验证、关闭、超长、背压 | 明文在本端；网络和普通中继只有保护后的数据 |
| 7 接收并验证 | 浏览器交付的 DataChannel 数据 | 门控、原始尺寸、schema、角色、epoch、序号和去重校验 | 未验证、格式错、重复、旧会话 | DTLS 负责密码认证，应用负责业务规则 |
| 8 解密与展示 | 认证通过的传输负载与业务校验结果 | 浏览器完成解密；应用纯文本显示并发 ACK | 业务校验拒绝、渲染异常 | 明文存在接收端；对端和本地恶意代码可读取 |
| 9 连接中断 | 连接事件、ACK 超时、网络变化 | 暂停新发送；未确认消息 unknown；显示中断 | 恢复超时、连接失败 | 网络可造成 DoS；超时不证明消息未被接收 |
| 10 重连或结束 | 有限恢复动作或结束动作 | 同实例同指纹恢复，或关闭并创建全新会话 | 指纹/PC/epoch 变化、恢复失败 | 新会话不得继承旧验证或自动重发旧正文 |

邀请凭据建议放 URL fragment，解析后从地址栏移除并仅留内存；这是降低 HTTP 访问日志泄漏的设计，不保证链接不被剪贴板、聊天工具、扩展或本地历史记录看到。凭据仍须发送给信令服务完成加入，所以不能声称服务器不知道邀请秘密。

初始协商由创建方 A 发 offer，B 只发 answer，两端同时发聊天消息不触发双 offer。若后续提供 ICE restart，同一 PC 的描述更新前先暂停正文；重新检查 DataChannel 对应 m= 段和 BUNDLE 绑定以及指纹。仅原绑定完全不变时恢复，否则撤销验证并新建会话。首版不允许任意媒体重协商或通过 control 指令换钥。

## 05_THREAT_MODEL

### 资产、信任边界与中间服务可见性

主要资产为聊天正文、端点证书私钥、会话交通密钥、身份验证绑定、邀请能力和消息送达状态。可信基础包括审计过的客户端代码、浏览器 WebRTC 实现、操作系统，以及用于核对指纹的独立可信渠道。

假设攻击者能控制信令、观察或操纵中继和网络、替换或重放连接信息，并尝试输入恶意消息。**信令服务被控**与**供应客户端 JavaScript 的服务被控**必须分开：前者可用独立验钥缓解；后者可直接在加密前后窃取正文，不能由网页内的锁图标解决。[1] [6]

| 位置 | 可见数据 | 在本方案下不应获得的数据 |
|---|---|---|
| 信令服务器 | IP、房间与 socket 关系、时间、SDP、ICE、公开证书指纹、加入能力 | 聊天正文、端点证书私钥和 DTLS 交通密钥 |
| STUN 服务 | 请求来源地址、端口、请求时间和网络探测 | 聊天正文；它不承载正常聊天消息 |
| 普通 TURN 中继 | 客户端 IP、分配与转发关系、时间、长度、流量，以及保护后的数据 | 已验证浏览器端点间 DTLS 正文与密钥 |
| 网络观察者 | 地址及流量特征；暴露程度取决于链路 | 已认证 DTLS 正文 |
| 浏览器端点 | 本端输入、收到的正文、公开指纹和内存态 | 不可对自己声称“看不到正文” |
| 被控制的前端/终端 | 可能读取输入、显示、调用发送接口、欺骗 UI | 本架构不能保证任何正文机密性 |

TURN 是原生数据包中继，不是终止 DataChannel 的服务端 WebRTC peer。若服务器实际作为 PeerConnection 端点再转发消息，DTLS 会在服务器终止，本方案的端到端边界即被破坏。TURNS 只是附加保护客户端到 TURN 的链路，不能替代端点 DTLS 或独立验钥。[1] [2]

### 威胁与隐藏测试点

下表均为设计与未来测试计划，当前状态统一为 `NOT_TESTED`。

| 场景 | ATTACK | EXPECTED_BEHAVIOR | TEST_METHOD | LIMITATION |
|---|---|---|---|---|
| 信令服务器被控制 | 替换 SDP，建立两条攻击者连接或丢信令 | 带外指纹核对不匹配；正文门关闭；可明确失败 | 受控信令替换成攻击者真实 PC 的指纹/候选，核对两端实际指纹 | 不能防 DoS；若前端供应也被控则超出保护 |
| 中继尝试读取消息 | 抓取 TURN 转发数据 | 只获得保护后的负载和元数据 | 强制 relay，结合 TURN/网络观测与信令帧检查 | 有 TURN 环境才可运行；不匿名 |
| 身份公钥被替换 | 替换证书指纹或引入新 PC | 验证失败/撤销，不静默沿用已验证 | 修改 SDP 指纹、换证书或换实例 | 只检验信令自报公钥不足以完成身份认证 |
| 消息传输篡改 | 修改 DTLS 密文数据包 | 篡改内容不交付；可重传、超时或失败 | 在下层受控网络夹具改写密文，比较接收正文和 ACK | 修改明文后由合法客户端重加密不属于此测试；错误码可不同 |
| 历史消息重放 | 重放网络记录或旧 Envelope | DTLS记录保护及应用epoch/序号检查阻止重复效果 | 分别重放抓包与旧 epoch 业务帧 | 浏览器不提供直接记录层注入 API；底层夹具不足时须标未测 |
| 消息顺序变化/重复 | 重排数据包，重复应用帧或 ACK | 单方向顺序保持；重复无二次展示/副作用 | 网络重排；注入相同 ID、倒退序号和重复 ACK | 不保证 A/B 合并的全局总序 |
| 网络断开/超时 | 切断连接、黑洞丢包、断信令 | 显示中断/未知，禁止新发送，有限恢复或失败 | 断实际网络路径并检查连接事件、心跳/ACK超时 | WebRTC 不一定即时感知物理断网；不得承诺零延迟检测 |
| 两浏览器同时发送 | 并发帧、ID/序号管理竞争 | 每方向独立序号；无漏发和重复；初始协商无 glare | A/B 同时各发固定数量唯一消息 | 全局展示时间仅供 UI，不是安全排序依据 |
| 刷新/关闭/崩溃 | 内存丢失；旧会话尚有未 ACK 消息 | 新会话新证书重新验钥；旧状态不恢复 | 刷新、关闭 tab、结束浏览器进程后重新加入 | 无离线历史；关闭事件不能保证送达另一端 |
| 本地存储读取 | 检查 Web Storage、IndexedDB、Cache Storage | 不存在应用主动保存的正文、密钥或验证记录 | 动态检查存储，静态检查写入路径 | 内存、swap、浏览器会话恢复、屏幕/剪贴板仍可能暴露 |
| 明文调试日志 | 正常或异常路径打印 body、密钥、SDP | 日志白名单不含敏感原文 | 独特无敏感测试标记；正常/失败/调试配置覆盖 | 一次日志搜索阴性不能证明所有分支安全 |
| XSS 泄漏 | 用消息、邀请参数或错误文本注入脚本 | 纯文本显示，不创建执行节点，不外发 | HTML、事件属性、恶意 URL 和参数载荷；CSP检查 | 真正发生XSS后，不能用“私钥不可导出”保证正文安全 |
| TURN/STUN 元数据 | 关联 IP、候选、时间与流量 | 文档和 UI 明示边界；最小化记录 | 观测各服务数据及直连/relay候选 | relay可减少对端直接IP暴露，但TURN仍知道客户端IP |
| 密钥变化仍显示安全 | 重协商或复用旧 UI 状态 | 立即暂停正文，核对绑定；变化撤销 | 换证书/PC/epoch、异常描述、恢复过程中检查 UI/API | 人工核对可能误操作；不能自动宣称现实身份可信 |

浏览器本地存储不能当作机密保险箱；非可导出密钥也不阻止恶意脚本调用密钥能力或读正文。纯文本渲染与敏感数据不落盘是降低风险，不是抵御已受控终端的承诺。[7]

**必须公开的隐私边界：端到端加密不等于元数据匿名，也不能保护被恶意软件、恶意扩展、XSS 或恶意客户端代码控制的终端。**直接 P2P 尤其可能让双方知道对方网络地址。TURN 模式也不提供对中继的匿名性或抗流量分析。[6]

## 06_FAILURE_RISKS

下列为风险排序，不是已发现的源码漏洞。

| 严重度/顺序 | 风险 | 为什么失败 | 阶段闸门 |
|---|---|---|---|
| Critical 1 | 只有 HTTPS/WSS，或服务器终止 WebRTC 再转发 | 服务器可见正文；不是题目所需端点边界 | R2：检查正文路径和终止位置 |
| Critical 2 | 不验证实际对端，或只比较信令自报值 | 恶意信令可静默 MITM | R2：真实攻击者 PC 替换测试 |
| Critical 3 | 固定密钥、硬编码私钥、服务端生成/持有端点私钥 | 一次泄漏影响全部会话，服务器可解密 | R2：密钥生成/生命周期审查 |
| Critical 4 | 自造协议，错误随机数、Nonce 或 KDF | 加密算法正确也不能补救协议错误 | R2：使用原生 DTLS，不另造 AES 协议 |
| Critical 5 | XSS、恶意前端、依赖被控 | 在加密前后直接窃取正文 | R4：输入输出、CSP、依赖和代码来源检查 |
| High 6 | 密钥/连接变化而验证状态不失效 | 用户向未认证的新端点发送信息 | R4：实例、指纹、epoch变更测试 |
| High 7 | 明文聊天、密钥、SDP或令牌进入持久化/日志 | 绕开网络加密泄漏 | R4：存储、日志及异常路径检查 |
| High 8 | send()成功就显示已送达 | 本地缓冲成功不等于对端收到 | R3/R4：ACK丢失、假ACK、超时未知 |
| High 9 | 重放/重复帧产生二次效果 | 重复消息、伪送达或状态错乱 | R4：去重、角色、序号、epoch |
| High 10 | 单页面模拟或只做Mock | 未验证真实两端、浏览器及网络条件 | R5：两个独立浏览器的真实链路 |
| High 11 | 强制受限网络验收却没有TURN | 本机可用不代表远端可连接 | R0冻结网络范围，R5验证实际候选 |
| High 12 | 新环境无法启动，锁版本/配置缺失 | 交付不能复现 | R6：全新目录复现 |
| Medium 13 | README缺少运行步骤及局限 | Owner无法启动或误解安全能力 | R6：按文档操作，不依赖作者补充 |
| Medium 14 | 宣称“绝对安全、匿名、已读、完备前向安全” | 保护范围超过证据 | R6：宣传与实现能力对齐 |

## 07_MVP_SCOPE

### 推荐方案

选择 **React + TypeScript + Vite 客户端，Node.js + ws 信令，浏览器原生 WebRTC 可靠有序 DataChannel，临时证书与全长 SHA-256 指纹带外认证，内存态聊天，Vitest/Playwright 测试**。这是技术建议，不是当前安装的栈或锁定的版本。Node版本、浏览器版本和依赖锁文件由 R0 确认。

WebRTC 数据通道使用 SCTP over DTLS。其加密和解密终止在两个浏览器，不在信令或普通 TURN 上；因此可以构成本题的浏览器端点间端到端加密，**不是“只用了 HTTPS”**。但 DTLS 对 SDP 所指端点的校验不自动认证现实中的通信对象，HTTPS信令也不能阻止恶意信令服务主动 MITM，必须独立验钥。[1] [2]

每个新会话生成一个 ECDSA P-256 `RTCCertificate`，显式用于创建 PC，取实际本地证书的 SHA-256 指纹。本地 `getFingerprints()` 可用时直接取值并与 localDescription 一致性核对；对端值取自当前 PC 已应用的 remoteDescription 中 DataChannel 对应的有效指纹，不取信令自报身份字段。浏览器实际 DTLS 握手校验证书匹配该 SDP。[3] [4] [5]

A 的本地指纹必须等于 B 当前连接的远端指纹；B 的本地指纹必须等于 A 当前连接的远端指纹。双方通过当面或其他已建立信任关系的独立渠道双向比较全长值，不自行设计短认证码或“六位验证码协议”。只核对一边、只点确认、或在本聊天室内发送指纹都不完成身份验证。

浏览器 API/SDP 解析无法可靠取得完整实际绑定指纹时，显示不支持并停止，不回退到未验证聊天。`getFingerprints()` 在旧浏览器可能不可用；可以评估受测试覆盖的实际 localDescription 读取，但不能回退到随便的信令字段。[4]

### 密钥生命周期与密码机制

证书私钥、DTLS交通密钥、随机数、Nonce、密钥派生和记录层认证由成熟浏览器实现负责。应用不导出密钥、不保存密钥、不自行生成 AES 交通密钥，也不管理自定义 Nonce。邀请令牌不是加密密钥，不能作为“服务端不知道秘密”的依据。

会话结束关闭 DataChannel 和 PC，清除验证、消息及证书引用；刷新丢失这些内存态。新会话重新生成证书并带外验证。不能宣称浏览器或 JavaScript 已物理擦除内存；也不能仅因为使用临时证书就宣称实现了 Signal 双棘轮或完备前向安全。

**首版不增加应用层加密。**这避免在有限时间内自造密钥交换、认证、Nonce和封装组合。如果未来必须通过服务器转发应用消息，或评分明确要求应用层密文，应另行评估经验证的成熟端到端协议及浏览器兼容实现，重新审计身份、会话建立、密钥派生、重放及生命周期；不能把 Web Crypto、libsodium 等原语库本身当成一个完整认证协议，也不能直接复用此版 JSON 到 WSS 并声称仍然 E2EE。

### 最小使用流程与界面

创建 → 复制邀请 → 独立浏览器加入 → 连接建立 → 可信带外双向核对指纹 → 发送纯文本 → 查看 ACK 送达状态 → 结束。界面分别显示“等待连接”“连接中”“通道已加密，身份未验证”“已核对本次会话端点”“连接中断”“身份发生变化”和“会话已结束”。同一界面明确提示无持久历史、非匿名、刷新须重新核对。

可把邀请有效期设为10分钟、建立连接预算设为30秒、ACK等待设为10秒、有限恢复预算设为15秒，作为可配置设计起点，而非协议安全常数。ACK超时为 unknown；本地确定未进入发送通道时才可判失败。设置UTF-8正文大小和帧大小上限，例如正文4 KiB；测试中文和emoji的字节长度，不用字符数代替字节上限。浏览器背压时停止继续入队，不能无界缓存。

### 明确不做

不做账号、多人群聊、AI、文件传输、支付和管理后台，因为与本题核心无关。也不做长期联系人身份、云历史、离线消息、跨设备同步和跨会话自动重发，因为会显著扩大密钥与存储风险。已读回执不做，ACK仅表示当前接收端已处理。匿名网络、流量填充和可信硬件不做，明确列为未提供的保护。

TURN 是网络适配条件项而非正文功能扩张。若 Owner 只要求同机独立浏览器，本版可先验证直连；若要求任意异地网络，应把受控 TURN 纳入 MVP，并确认凭据、部署及网络可用性。不启用 TURN 时，不得声称“任何网络都能建立连接”。

## 08_DEVELOPMENT_ROADMAP

以下各阶段都未开始。必须先由 Owner 明确授权 Phase 1；本报告不自动触发实现。无源码时“文件范围”只指第三节 PROPOSED 路径。

| 阶段 | 目标 | 文件范围：PROPOSED | 依赖 | 测试方法 | PASS/FAIL闸门 | 复杂度/估算 | 失败处理 |
|---|---|---|---|---|---|---|---|
| R0 项目基线 | 确認新建或既有仓库、版本、网络和交付要求 | 基线配置、README草案、环境模板 | Owner授权、仓库/新建选择 | 后续才运行安装/启动；检测浏览器能力 | PASS：确定可复现基线与边界；FAIL：缺环境或接口要求冲突 | 中，2–3人时 | 停止相关开发，补材料/调整兼容方案，不猜现有API |
| R1 真实连接 | 两端通过SDP/ICE建立真实通道 | signaling、rooms、peerConnection | R0 | 两独立浏览器、失效邀请、第三人、连接超时 | PASS：真实通道和明确失败状态；FAIL：只有Mock或不稳定 | 高，3–5人时 | 诊断ICE/候选与网络；需TURN则先明确条件；不得公开未认证聊天 |
| R2 加密与身份 | 临时证书、实际指纹、不可绕过验证门 | certificate、fingerprint、verification、安全UI | R1 | 未验证发送/接收、攻击者PC替换、指纹缺失/变化 | PASS：验钥完成才处理正文；FAIL：任何静默绕过 | 高，4–7人时 | 阻断聊天；修复绑定，不用自报字段或弱算法降级 |
| R3 聊天交互 | 纯文本、封装、ACK、并发、背压与状态 | messages、messageProtocol、state、ChatPanel | R2 | 双向连续、并发、ACK丢失、错ACK、尺寸边界 | PASS：只展示一次；送达语义真实；FAIL：假送达/漏重复 | 中，3–5人时 | 简化为单通道，关闭自动重发，保留unknown |
| R4 安全异常 | 生命周期、重放、篡改、存储、日志和XSS | tests/unit、integration、隐私/日志模块 | R2/R3 | 第五节负向用例及受控网络夹具 | PASS：关键项真实有证据；FAIL：静默MITM/泄漏；缺夹具为NOT_TESTED/BLOCKED | 高，3–5人时 | Critical问题阻断；无法执行的测试列限制，不改成PASS |
| R5 真实E2E | 两真实浏览器端到端验收 | tests/e2e、浏览器配置、脱敏证据 | R4、可用测试网络 | A/B双向、并发、刷新、断网、直连；需TURN时relay | PASS：核心矩阵运行通过；FAIL：只单页/Mock或关键项失败 | 中至高，2–4人时 | 缩小并公开支持范围；关键安全失败不得交付为完成 |
| R6 打包复现 | 完整源码文档、测试结果和清洁交付 | README、SECURITY、TEST_REPORT、锁文件 | R5、官方交付规则 | 全新目录按README复现、包内容审查 | PASS：可复现且提交规则满足；FAIL：需秘密补丁/含凭据/规则缺失 | 中，1–2人时 | 修正文档配置，清除交付敏感内容；未知规则向Owner确认 |

合计约 **18–31 人时**，是假设有经验工程师、明确浏览器范围、可用本地环境且无额外应用层协议要求的设计估算，不是承诺。异地TURN部署、底层DTLS故障夹具或严格多浏览器兼容可能另需时间。未给考试时长，因此无法证明该估算符合考试窗口。

## 09_ACCEPTANCE_MATRIX

### 重复执行规则

以两个独立浏览器进程/配置或不同浏览器作为 A/B，推荐再加入不同设备测试。自动化可以使用独立浏览器进程或经过确认的独立上下文连接真实服务；但不能以同页两个组件代替两端。至少一次人工 Chromium/Firefox 或两个独立 profile 验收。跨网络和 TURN 是独立覆盖维度，不能由同机测试代替。

每次记录浏览器版本、构建/提交标识、网络和候选类型、用例编号、步骤、预期、实际、状态及脱敏证据。测试仅用无敏感合成消息。证据所需指纹和测试 ID 放在专门脱敏验收材料，不打开生产详细日志，不保存邀请令牌、正文抓包原文或私钥。自动化点击验证按钮证明门控逻辑，不等于完成独立可信带外认证；需要人工验钥记录。

状态：`PASS`仅限真实执行且满足条件，`FAIL`为实际不符合，`BLOCKED`为有明确外部阻塞，`NOT_TESTED`为未执行。当前不存在可运行项目，所以下表全部为 **NOT_TESTED**。

| ID | 用例 | 重复执行步骤：后续实施 | 预期与判定条件 | 层级/证据 | 当前状态 |
|---|---|---|---|---|---|
| T01 | 两真实浏览器连接 | A创建，B加入，建立真实PC与DataChannel；带外验钥 | 两端通道open，实际指纹对应，正文门仅验钥后打开 | E2E、浏览器/候选与验钥记录 | NOT_TESTED |
| T02 | A→B | A发唯一ID纯文本，B处理并ACK | B一次展示，A仅收到匹配ACK后delivered | E2E、脱敏事件 | NOT_TESTED |
| T03 | B→A | 反向执行T02 | 与T02对称，不是单向功能 | E2E | NOT_TESTED |
| T04 | 连续多条 | 每方向各发至少100条唯一合成消息 | 每方向顺序正确、无漏/重复、ACK关联正确 | E2E、计数及ID/序号 | NOT_TESTED |
| T05 | 服务端不能读正文 | 发送独特合成标记；观测所有信令帧及服务端日志；若有TURN则抓中继路径 | 信令仅连接信息；不出现正文或密钥；确认无服务器终止DTLS | 架构审查+集成抓包/日志，不仅grep | NOT_TESTED |
| T06 | 错误密钥/证书认证 | 向接收端提供与真实peer证书不符的SDP指纹，或用受控端点证明缺少预期私钥不能完成握手 | 不能形成满足预期证书绑定的通道；不处理正文 | 握手负向集成；不是应用decrypt单测 | NOT_TESTED |
| T07 | 篡改消息认证 | 在DataChannel下方修改DTLS密文；允许浏览器重传合法原包 | 不交付篡改正文；失败或合法重传均可，不能假ACK篡改内容 | 网络夹具、接收结果；无夹具则仍未测 | NOT_TESTED |
| T08 | 重放与去重 | 同epoch重复Envelope及ACK；旧epoch帧；可选网络记录重放 | 无二次展示/副作用，旧会话不改变送达状态 | 单测+集成；底层与业务层分开 | NOT_TESTED |
| T09 | 身份异常变化 | 建立验证后替换证书、PC或有效远端指纹 | 验证撤销、暂停/拒绝正文、清晰变化告警 | 集成、UI和底层门控 | NOT_TESTED |
| T10 | 网络断开 | 实际断路径及黑洞丢包，覆盖已buffered未ACK消息 | 中断/超时可见，发送停止，未确认为unknown | E2E、事件时序 | NOT_TESTED |
| T11 | 刷新/重连 | 刷新一端；新PC/epoch；另测同PC同指纹ICE恢复 | 新会话不继承验证历史；同绑定恢复按设计；无跨epoch自动重发 | E2E | NOT_TESTED |
| T12 | 日志不泄漏 | 正常、错误、断网、拒绝帧路径；检查控制台及服务器/代理日志 | 无正文、私钥、交通密钥、SDP原文或邀请令牌 | 静态+动态、白名单审查 | NOT_TESTED |
| T13 | 全新目录复现 | 后续在清洁目录按README安装、配置、启动和执行核心验收 | 不依赖作者现有缓存/隐藏凭据，步骤完整 | 实际复现记录 | NOT_TESTED |
| T14 | 未验证消息门 | 未验钥时调用底层发送；受控对端提前发text/ack | 本端拒发；入站丢弃不缓存不ACK；验后不补展示 | 单测+集成 | NOT_TESTED |
| T15 | 真正MITM | 信令连接A↔攻击者和攻击者↔B，两条合法DTLS | A/B带外实际指纹不对应，不发送正文 | 攻击者真实PC夹具+人工验钥 | NOT_TESTED |
| T16 | 两端同时发送 | 双方同时各发100条，各自独立序号 | 每方向正确，无ID冲突/竞态；不要求全局总序 | E2E | NOT_TESTED |
| T17 | 假ACK/ACK丢失 | 未知ID、错角色、旧epoch、重复ACK；正文已处理但阻断ACK | 假ACK不delivered；未ACK为unknown，不误报未送达 | 单测+集成 | NOT_TESTED |
| T18 | 顺序/边界/schema | 重排网络；倒退序号、超大UTF-8、非法字段、同ID不同内容 | 有序或拒绝符合规则，背压有界，异常不崩溃 | 单测+网络集成 | NOT_TESTED |
| T19 | 本地存储 | 聊天后检查local/sessionStorage、IndexedDB、CacheStorage及应用缓存 | 没有应用主动持久化的正文、密钥和验证状态 | 静态+动态 | NOT_TESTED |
| T20 | XSS | 消息、昵称若有、邀请参数及错误文本加入HTML/脚本/事件属性载荷 | 按文本显示，不执行、不外发，不可影响安全状态 | 浏览器E2E、CSP检查 | NOT_TESTED |
| T21 | 邀请与信令异常 | 过期令牌、第三人、错房间、异常offer/candidate顺序、洪泛 | 明确拒绝，原会话不串线，诊断不含敏感原文 | 服务端集成 | NOT_TESTED |
| T22 | 强制TURN | 有受控TURN时设relay策略，验证候选及T02–T09关键项 | 中继未终止端点DTLS；仍验钥，无正文泄漏 | 条件集成；缺环境为BLOCKED | NOT_TESTED |
| T23 | 浏览器能力不足 | 目标Chromium/Firefox/Safari版本；指纹API或实际绑定读取缺失 | 明确不支持或经验证的读取方案；不能降为已验证 | 兼容性矩阵 | NOT_TESTED |
| T24 | 合法端点改明文 | 已验证A主动修改正文，再通过自身合法通道发送 | B正常收取；用例说明端点真实性不保证内容善意 | 限制验证，不作为传输篡改失败 | NOT_TESTED |
| T25 | 信令断开 | 已建立直接通道后停信令，另测建链前停信令 | 已有通道按实际状态继续或明确失败；不得凭WSS状态宣称DataChannel断开 | E2E、分离状态检查 | NOT_TESTED |

**T06/T07的可测试性限制：**网页API通常不暴露DTLS私钥和任意密文解密入口。T06可验证声明证书与真实私钥端点不匹配时的握手失败，但不能把它写成“已对AES密文用错误密钥解密”。若评分要求直接执行密码原语wrong-key测试，则当前选型与验收要求存在差异，需Owner确认或另选经过验证的应用层协议。T07必须在加密后改密文；改应用JSON后再由合法端点发送，会产生有效DTLS认证，不能用来证明传输篡改检测失败。

T05中的日志/抓包只能证明特定运行链路及观察范围，必须同时审查客户端发送路径、服务器角色、可见配置和无明文回退。不能以“日志没搜到关键词”单独证明任意被入侵的部署永远无法读正文。

## 10_OPEN_QUESTIONS

1. 是否有现有仓库、分支或本地源码路径？若有，应提供位置并补做完整只读源码审计；若没有，是否授权从零新建？
2. 官方题目原文、评分细则、提交说明和考试时限是什么？是否明确要求应用层加密、直接错误密钥解密测试或特定接口？当前为 `SUBMISSION_REQUIREMENTS_UNKNOWN`。
3. 目标验收是同机双浏览器、局域网还是异地受限网络？TURN是否必须，以及是否提供测试环境？
4. 是否接受“临时会话端点身份 + 可信带外全长指纹双向核对”，而非账号或长期联系人认证？
5. 目标浏览器和最低版本是什么？是否要求Safari和旧版浏览器，能否对不支持安全绑定的版本硬失败？
6. 是否接受刷新结束会话、聊天历史不持久化、未ACK消息可能为unknown、跨新会话不自动重发？
7. 提交是否要求部署、视频、截图、源码压缩包或特定目录？必须待规则明确后决定，当前不部署。
8. Owner是否明确授权进入Phase 1？权限模式改变本身不构成开发授权。

### 最终决策

```text
SOURCE_STATUS = NOT_PROVIDED
SOURCE_NOT_PROVIDED = TRUE
SUBMISSION_REQUIREMENTS_UNKNOWN = TRUE
REQUIREMENTS_STATUS = PARTIAL
MVP_FEASIBILITY = MEDIUM
READY_TO_IMPLEMENT = NO
RECOMMENDED_TECH_STACK = React + TypeScript + Vite / Node.js + ws signaling / native WebRTC reliable ordered DataChannel with DTLS / ephemeral ECDSA P-256 RTCCertificate / full SHA-256 out-of-band fingerprint verification / memory-only state / Vitest + Playwright
ESTIMATED_IMPLEMENTATION_EFFORT = 18–31 person-hours, conditional on environment, browser and network scope; TURN and low-level DTLS test fixtures may require additional time
TOP_3_RISKS = 1) fingerprint verification not bound to the actual DTLS endpoint or silently inherited after identity change; 2) plaintext exposed by client code/XSS/logging/persistence or a server-side DTLS endpoint; 3) insufficient time/network/test infrastructure for real dual-browser and reproducible negative security tests
NEXT_ACTION = Owner supplies repository or confirms a new project, clarifies submission/network/time constraints, and explicitly authorizes Phase 1; if existing source is supplied, audit it read-only before implementation
```

MEDIUM是针对当前缺少源码、考试时限、网络范围和提交规则的交付可行性判断，不是否定原生WebRTC方案的技术可行性。READY_TO_IMPLEMENT为NO，是因为还没有Owner的第二阶段授权，且项目起点与关键验收边界尚未确认。

**Phase 0 到此结束。未开始实现；等待 Owner 明确授权第二阶段。**

## References

[1]: https://www.rfc-editor.org/rfc/rfc8827.html "RFC 8827 — WebRTC Security Architecture，尤其第4.3及9.1节"
[2]: https://www.rfc-editor.org/rfc/rfc8831.html "RFC 8831 — WebRTC Data Channels，SCTP over DTLS的保密、完整性和来源认证"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/generateCertificate_static "MDN — RTCPeerConnection generateCertificate，临时证书及支持算法"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/RTCCertificate/getFingerprints "MDN — RTCCertificate getFingerprints，指纹读取、端点绑定与带外验证"
[5]: https://w3c.github.io/webrtc-pc/ "W3C — WebRTC PeerConnection，证书配置和生命周期"
[6]: https://www.rfc-editor.org/rfc/rfc8826.html "RFC 8826 — WebRTC Security Considerations，恶意前端和IP位置隐私"
[7]: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html "OWASP — HTML5 Security，纯文本处理及浏览器存储风险"
[8]: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html "OWASP — Logging，日志中应排除密钥、令牌及敏感原文"

日志设计依据OWASP的敏感信息排除原则；本题对聊天正文和连接信息采用更严格的诊断白名单，不能用调试需求绕开。[8]
