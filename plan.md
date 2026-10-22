# QuietPeer 实施方案

Owner已授权从零连续实施R1–R6，已选择Manus管理项目且不公开发布。只修改本目录；无数据库、账号、群聊、AI或文件传输。开发、生产构建本地验收都采用Node HTTP服务同源承载Vite或dist及/signaling WebSocket，服务仅监听loopback，端口由环境提供，不配置公网部署。

## 实现

React/TypeScript界面；Node/ws房间信令只收create/join/offer/answer/leave，不接受聊天正文。非trickle ICE：浏览器收集候选后发送完整SDP，避免候选竞态；连接超时明确失败。两个端点建立可靠有序DataChannel。每个会话生成浏览器ECDSA P-256证书，实际DTLS远端DER证书用WebCrypto SHA-256计算，与实际remoteDescription、transport证书stats交叉核对；本地getFingerprints与PC配置、本地SDP和stats对应。没有可靠绑定则失败关闭，不认证降级。

双方通过可信带外渠道核对全长指纹，在UI输入独立渠道取得的对方指纹，匹配才确认。本端本地确认与对端在实际DataChannel内的有限verification-confirm控制共同允许正文；对端确认不替代本端人工核对，信令无验证权限。每次实际发送前异步重新检查绑定；监控DTLS/连接状态和定期证书检查。输入错误指纹即终止并告警。新PC/epoch不继承验证。

消息由DTLS加密；应用层规范版本/epoch/角色/uint64序号/随机ID，去重和ACK收取确认。只在有效ACK后已送达，超时送达未知。正文4KiB、帧8KiB、消息总量和发送背压有界。不持久化正文/证书/验证，不自动跨会话重发。刷新结束，断线可明确失败，有限同绑定恢复不保证离线消息。日志只固定代码，不输出正文、SDP、邀请令牌或私钥。

## 结构

- src/core：协议、证书绑定、安全状态机与聊天客户端。
- src/ui、src/App.tsx、src/styles.css：产品界面，指纹验证、邀请、状态、聊天。
- server：HTTP/Vite/static服务与严格信令房间。
- shared：前后端信令类型与schema。
- tests：协议/房间单测及真实双浏览器E2E；专门测试构建使用夹具，不进入普通构建。
- docs：安全模型、最终验收与失败留存说明。
- public：本地资源与页面路由manifest。

依赖采用已有npm 11.6.2固定packageManager与package-lock；项目.npmrc明确允许必要生命周期脚本，不安装全局工具。TypeScript check-only作为诊断兜底。按锁文件安装、构建、启动、单测和Playwright，再打包及新目录复现。

## 视觉设计

候选：瑞士编辑式安全通信（0.06）；暗色终端极简（0.04）；柔和日式工具（0.03）。选择瑞士编辑式：克制、清晰、有温度，不营造无法证实的安全感。

设计运动：Swiss editorial modernism。原则：大留白、明确层级、真实状态、有限色彩。浅石灰背景，墨色文字和深森林绿主操作，琥珀用于未验证，红色只用于失败。布局为偏左品牌与会话导航、中心聊天工作区、右侧安全详情，移动端垂直堆叠。签名元素为细线边框、圆角方形双链图标、等宽完整指纹。使用系统本地无衬线字体及系统等宽，无远程字体或装饰图，避免第三方网络请求。

交互：创建与加入清晰分离，验证前关闭输入；危险动作明确但不繁琐。动画仅120–180ms状态淡入，尊重prefers-reduced-motion。品牌QuietPeer：为需要直接私密交流的两个人提供可核验的端点连接；克制、坦诚、专注。文案例：“只在你们之间。”、“通道已加密，身份仍需核对。”绿色#235c44是主品牌色。标志用本地打包Lucide链路图标搭配紧凑字标，不增加装饰插画。
