# 预览 Auth 隔离用例 CI 竞态（2026-10-17）

## 证据与判断

用户提供6ada219运行39035616681的摘要：25 passed、1 failed、2 skipped，最后存储快照只有preview仍有值，production和旧v1/v2均保留。公共run页确认应用检查Failure；完整日志需要登录，当前GitHub API仍Forbidden，未声称下载了完整日志。

本地检查锁定版本Supabase Auth SDK：`_signOut`先await `admin.signOut`请求，再await `_removeSession`；后者依次删除自身session/PKCE/user键，最后发出SIGNED_OUT。App立即隐藏业务数据，但异步退出操作尚需完成。Playwright的button.click只保证点击动作已派发，不等待React事件处理器中的网络与SDK清理。

原测试在两次点击退出后都没有等登录页，第一次还手动removeItem预览键，随后可能在SDK仍执行时重载；最后立刻一次性读取存储，正好会捕获正常的“退出中”状态。这个时间点null不是正确SDK契约，**退出确认后null仍是必须保持的严格契约**。

生产和预览存储键不同；没有证据表明预览读写生产会话，也没有把本次失败归咎于PWA缓存或自动恢复。此次没有改动运行时代码、数据库、存储命名或SDK版本。

## 修复及更强的断言

- 两次退出均等待SIGNED_OUT对应的登录页可见后，再检查存储或布置fixture。
- 移除测试手动删除预览键的动作，不能用测试自身擦除掩盖应用问题。
- 最后退出用可释放Promise控制/logout响应，不使用固定sleep。等请求确实进入handler后，预览会话仍非null的断言确定性复现旧时序；释放响应、等待登录页后，再完整断言preview=null、production逐字节不变、v1/v2不变。
- 退出后再次重载，继续检查登录页及相同完整存储对象，防止自动恢复生产会话或重新写回预览session。
- 模拟登录每次生成不同session编号与refresh token；额外确认新预览会话与保留的旧生产会话不相同。避免过去模拟登录重复返回同一个token造成假阳性。
- 失败用例保留，原最终隔离断言没有删减/放宽，也没有新增skip。原有production/preview专属用例的不适用路径skip维持不变。

## 验证

可控退出场景先重复5次通过；全量测试重新串行执行。一次全量启动与重复测试争用本地5173端口，属于执行调度问题，未更改严格端口配置，待前次结束后重跑。

最终单元、浏览器、类型、格式、两种构建及远端工作流结果见validation.md。没有数据库操作、main合并或网站部署。模拟token与真实Supabase JWT验收仍严格区分。
