# 认证、迁移、离线同步和冲突协议

## 邮箱密码与回调

未来前端使用 supabase-js v2 的公开 URL + publishable key，PKCE 流程。登录表单 signInWithPassword；注册 signUp(email,password, options.emailRedirectTo=已允许的 Pages根URL)，若无 session 显示“等待邮箱验证”，不要跳进迁移。登录错误用通用提示，不枚举账号；遵循服务端密码策略、请求限流和重发间隔。

邮箱确认链接进入根路径，先处理 ?code=（exchangeCodeForSession）/错误参数，再启动当前 hash router。同设备浏览器需保存 PKCE verifier；iPhone 邮件打开到另一浏览器、隐私模式或电脑打开手机申请的链接可能没有 verifier，显示失败原因与重新发送/在发起浏览器打开，不假定跨设备验证能自动建立 session。仍允许验证后正常密码登录。明确测试 Supabase 实际邮件模板，不能把 token_hash 当作 code；如采用 verifyOtp 模板则需另外评审回调参数与白名单。

密码重置 resetPasswordForEmail(email,{redirectTo:根URL})；回调恢复会话并识别 PASSWORD_RECOVERY 后显示专用新密码表单，成功 updateUser({password}) 后清理 URL 敏感参数、退出恢复态。会话刷新/恢复不能先落入普通今日页。邮件链接 URL不带业务 hash，避免与现有 hash router 冲突；Auth 初始化完成再导航 #today。拒绝任意 next/redirect URL，参数不得写日志。

登出前提示该账号未上传操作数量：联网时先尝试同步，或用户明确“保留队列并退出”；不转给下个账号。离线登出也清除当前会话/UI引用，认证服务端撤销可能失败需说明。缓存仍按 user/project 隔离，保留待发送队列供同账号重新登录恢复；提供显式“删除本设备该账号缓存”（导出/确认后），不删除旧 v1/v2。退出不会删除云数据；撤销刷新令牌后已签发 access token 的实际有效期需按 Supabase策略测试。

## 首次本地迁移

1. 未登录保持 V1.1 本地模式。登录不触发自动上传；询问是否把此设备本地数据导入当前显示的邮箱账号。默认不迁移。
2. 读取 v2 或原 v1 的原始字节，在内存通过 parseSnapshot；原键不写、不删除。提供原文 JSON 下载；用户确认已保存备份后继续。
3. 做迁移预检：ID长度、createdAt整数范围、日期/时区、重复与未知引用、5 MiB限制、计划历史、备注范围；不合法时展示明细并停下，不能清空或跳过记录。
4. 为备份计算 canonical content SHA-256（固定字段顺序、数组按稳定键排序；排除 snapshot.revision，不裁剪备注文字），并另记录原文件 hash 校验来源。固定 user/project 与数据集，在本地迁移日志保存 batch ID、映射及阶段；SQL source_sha256存 canonical hash。
5. 拉取一致云快照与水位，预览新增/已存在/冲突/重映射，展示习惯、日期范围、备注和排序差异。相同 ID+内容跳过；相同 ID不同内容必须选择保留云端、保留本地副本（新 ID 并递归重映射引用）或逐字段合并。仅名字相同绝不自动当同一习惯。预设分类按已知 preset ID映射；不同名称需确认，不以名称猜 ID。
6. 相同习惯日期记录按自然键去重；有远端撤销/删除墓碑时不能自动复活。不同备注提供并排预览，不静默覆盖。云端已有排序默认保持，导入新习惯追加，重新排序需单独确认。
7. stage 使用独立 batch数据并保持线上数据不变；commit RPC重新检查预览所有实体的基线版本、完整验证引用和范围，事务提交实体、事件、receipt、import_batch状态。基线变化返回需重新预览，绝不覆盖。大量导入通过私有 staging 分块传输+最终单事务合并，未来需 staging 表迁移，基础 SQL 没有实现上传分块接口。
8. 超时不判断失败或重复导入；用相同 batch/operation ID查结果，hash不匹配拒绝。断网保留stage进度；真正失败回滚整批（线上不留半数据），用户可重试/取消，原localStorage保持原样。结果未确认前不标记成功。
9. 完成后核对云端计数、映射和代表性记录，再主动启用该账号云模式。原 v1/v2 永久保留，明确它们不是云数据实时镜像；云模式新修改只写新缓存。退出可选择只读查看原本地副本，不把两个空间默默合并。

JSON恢复在云模式复用上述合并预览与版本控制，备份内 user_id/version/权限字段不可信，不执行整体替换。用户要求恢复为旧版本时先备份当前云数据，输出显式差异/墓碑操作并确认，需单独实施；基础阶段不提供“一键清空云端”。

## 客户端与离线队列

用 IndexedDB事务同时写实体缓存与 outbox（localStorage双写不原子）。Repo层分 LocalRepository / CloudRepository，domain不读取JWT或网络。缓存键绑定project ref与user_id；operation 包含UUID operationId、deviceId（仅追踪非身份）、entityKey、baseVersion、baseValue、目标值、依赖operationIds、payloadHash。完成操作是 set completed=true/false，不能发送 toggle；删除为 tombstone，撤销打卡与备注互不关联。

登录且会话有效→拉取快照/游标→重基未发操作→发送按依赖排好的批次→处理receipt→拉取新事件。每批确认后用一个IndexedDB事务更新缓存、移除已确认队列、推进游标。网络超时同ID重试；429/5xx指数退避+jitter，401先刷新一次session，刷新失败暂停队列；403/校验失败不无限重试，展示可处理错误。navigator.onLine仅提示，必须真实请求验证。恢复网络、focus、visibilitychange及适度轮询触发；iOS后台定时器不可依赖。Realtime可作“有变化”提示，不能替代持久游标；本次SQL不加入Realtime publication。

离线指已加载页面+缓存下可编辑，GitHub Pages的首次离线加载需要独立PWA阶段，不能声称已支持。IndexedDB/Safari配额、私密模式或清理导致缓存不可用时切只读并建议备份，不能显示已保存。

## 冲突判定

服务器比较 expectedVersion，在每用户锁下CAS；不存在记录的版本为0。失败返回当前版本与目标冲突，客户端不能以设备时钟自动最后写入胜出。

| 场景                   | 行为                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| A改习惯名、B改颜色     | 按baseValue三方比较不同字段可自动合并，再带新版本重试；标记合并记录                            |
| A/B都改同一字段        | 展示本地/云端两值，用户选择；不静默覆盖                                                        |
| 两端都设置同一日期完成 | 相同目标幂等达成，保留原operation收据；相反状态提示冲突，不再次toggle                          |
| A撤销、B写备注         | 两个实体独立，均可成功                                                                         |
| 两端改同一备注         | 保留候选全文，逐条选择或手工合并；不字符串拼接覆盖                                             |
| 删除/归档与编辑        | 删除已提交则编辑不能复活；允许明确“恢复为新习惯”重新ID映射；归档要检查日期和关联事务           |
| 两端改下周计划         | 同habit/effectiveDate唯一；冲突需选择，不改历史；已生效后任何旧编辑拒绝                        |
| 两端重排               | 一条全局排序版本CAS；选择保留某一顺序或按“移动X到Y前”意图重基后预览，不按order整数混排         |
| 多次本地编辑同一实体   | 使用依赖链，前一receipt返回版本供下一操作；仅未发送操作可安全合并，不改变已发operation payload |

同步状态明确区分“已保存到本机/离线待上传N条/同步中/已同步（服务端确认时间）/需处理冲突/登录已过期/存储不可写”。冲突保留在缓存与可导出备份，不能为了显示已同步删除冲突队列。

事件分页：拉取事务固定highWater H，按sequence>cursor AND <=H排序分页；逐页应用后推进cursor，下一轮请求新H。事件payload不可变；完整快照与H必须在单条SQL语句的同一MVCC快照产生，或先对sync_head获取FOR SHARE锁并持有到所有实体读取结束（写事务统一先FOR UPDATE锁同一行）；不能仅依赖READ COMMITTED下多条SELECT处于同一个事务。没有时间戳过滤游标、不能按max(updated_at)推进。清理日志前维护最老可恢复游标，过期返回full_resync_required；先保存并重基未上传队列，不覆盖它。

## 时区与历史

首次账号时区需用户确认，默认采用当前浏览器 IANA时区（上海背景建议Asia/Shanghai，不强制所有人相同）。云账号一份时区保证电脑/iPhone“今天”一致；跨时区提示日历时区。迁移原日期不移动；周一到周日、有效日、周次数与连续天数沿用现有设计。时区更改仅影响之后“今天”的判断与计划编辑生效日，不重写旧date；当前待处理队列保留原目标日期并重新验证。
