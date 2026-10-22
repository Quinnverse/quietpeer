# QuietPeer 安全模型

## 信任边界

正文在发送者浏览器输入，交给WebRTC可靠有序DataChannel，经SCTP over DTLS到接收者浏览器后解密展示。Node信令服务只转发完整offer/answer SDP，不是WebRTC数据端点，不存在WSS正文回退。信令可见房间、加入能力、公开证书指纹、SDP/ICE、IP和时间，不能据此被称为匿名系统。

浏览器、操作系统、客户端代码供应与带外核对渠道属于信任基础。恶意前端、XSS、恶意扩展、已控制的终端可以在加密前后读写正文、欺骗UI或使用密钥能力。DTLS不可保护这种终端失陷。对方作为合法已认证端点也可保存、修改和转发收到的消息。

## 实际证书与身份认证

每个会话调用浏览器`RTCPeerConnection.generateCertificate({name:'ECDSA',namedCurve:'P-256'})`，用返回证书显式创建PC，不导出私钥，不使用固定共享密钥。浏览器完成DTLS握手、随机数、密钥协商、Nonce、派生和记录认证；应用不自造密码学协议。

本端指纹来自`RTCCertificate.getFingerprints()`；实际PC配置必须使用同一证书。本地SDP与`getStats()`的transport.localCertificateId指向的证书指纹及DER摘要必须一致。

远端优先读取`pc.sctp.transport.getRemoteCertificates()`返回的实际DTLS DER证书，用标准WebCrypto SHA-256计算全長摘要；同时核对实际remoteDescription和transport.remoteCertificateId引用的证书stats/DER。若远端DER接口无可用返回，可使用标准transport引用的certificate stats DER重新计算，而不是信令自报值。只允许单一application传输；证书stats/可靠API不支持时拒绝身份认证并关闭聊天，不静默降低保障。

两端通过独立可信带外渠道完整核对SHA-256指纹。每端输入带外取得的对方指纹与实际绑定匹配后才本地确认。DataChannel上的verify帧只表示该端点的确认动作，不替代本端人工核对；服务器没有verify API。双方确认与实际绑定均满足才处理正文。验证前提前收到text/ack不缓存不展示不ACK。

发送和入站敏感效果前再次读取证书绑定；周期性监控实际DTLS状态和指纹。连接变化或核验失败撤销验证并阻断；不支持任意重协商/换钥控制。新PC/epoch和刷新不能继承旧认证。认证对象是本次会话私钥控制端点，不是账号、长期联系人或法定身份。用户误核对或带外渠道被攻陷仍可导致误认证。

如果支持浏览器无法提供这些标准证据，则显示限制并停止：可替代方案是升级支持标准API的浏览器，或后续经过单独授权评估经验证的认证端到端协议/受审计客户端；不以六位短码、自报公钥或自制AES组合替代。

## 应用消息与重放

DTLS提供端点间机密性、完整性与记录层保护；它不替应用完成消息ID去重、跨会话隔离或送达语义。应用封装包含版本、epoch、固定发送角色、规范uint64序号字符串、128位安全随机ID。序号按方向独立；不依赖墙钟判重，也不承诺双方全局总序。

每个方向收取状态维护高水位和ID。相同ID/序号/正文的重复消息只允许重发原收取ACK，不二次展示；不同正文同ID、未知倒退序号、错角色和旧epoch拒绝。所有schema使用字段白名单，正文4KiB、帧8KiB、会话最多2000条，发送缓冲有界。合法对端能产生新ID和新序号，并不能据此保证其业务意图善意。

ACK只接受当前对端、当前epoch、匹配待确认ID与序号。send成功只本地buffered；有效ACK才delivered。ACK超时为unknown，不是未送达事实。不自动跨epoch重试或重发。

## 本地数据、日志与网页

聊天、证书句柄、验证状态仅内存；不用localStorage、sessionStorage、IndexedDB、CacheStorage或service worker保存敏感信息。不使用数据库或第三方遥测/远程字体/脚本。UI纯文本React转义，无dangerouslySetInnerHTML。服务器仅固定事件代码/类别计数，不记录SDP、正文、令牌或私钥。CSP限制脚本/连接来源，开发HMR与普通构建政策区分。

结束清除应用引用，不保证JavaScript/浏览器/OS物理安全擦除、swap或crashdump无明文；DOM、屏幕、剪贴板、辅助技术和浏览器会话恢复也不是受保护保险箱。邀请URL fragment减少HTTP请求路径泄漏，但信令必须知道加入能力，剪贴板和分享渠道也可泄漏邀请。

## 网络与可用性

服务默认只监听127.0.0.1，测试使用本机真实WebRTC host候选。未配置公共STUN/TURN，也没有公网部署、生产密钥。不能承诺异地NAT穿透。信令可丢消息、替换SDP或拒绝服务；独立完整验钥抵御静默MITM，但不能防DoS。完整主动MITM需要真实攻击者双连接夹具，若未执行应在报告标NOT_TESTED。

WebRTC在不同浏览器上的原生断线探测延迟不同；应用用实际连接事件加DataChannel ping/pong判断无响应，不能把navigator.onLine或WSS状态单独当作P2P状态。断线暂停/失败，新会话重新验钥。当前不提供离线队列和可靠跨会话恢复。

直接P2P可能暴露双方IP和流量特征。未来普通TURN只转发端点DTLS密文，仍见客户端IP、转发关系、时间及长度；若服务器作为WebRTC peer终止DTLS，就破坏这里的端点边界。TURN及下层密文篡改、记录重放需独立基础设施，不以Mock宣称已验收。

## 测试与免责声明

测试使用合成消息和独立浏览器上下文；API故障注入用于验证本应用fail-closed逻辑，不能说它证明真实网络MITM或底层密码强度。自动化跨上下文复制指纹验证软件流程，不证明真人完成了独立可信渠道认证。握手证书负向、下层DTLS篡改、恶意终端保护和异地网络覆盖在最终报告单独标注。

此交付不宣称绝对安全、元数据匿名、抗DoS、已读证明、Signal双棘轮、完备前向安全或第三方安全认证。

## 标准依据

- RFC8827 WebRTC Security Architecture：https://www.rfc-editor.org/rfc/rfc8827.html
- RFC8831 WebRTC Data Channels：https://www.rfc-editor.org/rfc/rfc8831.html
- WebRTC PeerConnection/DTLS证书接口：https://w3c.github.io/webrtc-pc/
- WebRTC Stats实际证书引用：https://www.w3.org/TR/webrtc-stats/
- OWASP HTML5/Logging Cheat Sheets：https://cheatsheetseries.owasp.org/
