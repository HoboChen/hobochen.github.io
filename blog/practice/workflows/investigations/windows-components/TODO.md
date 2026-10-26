# Windows 调优 TODO

## 预装应用清理

- [ ] 卸载 UWP bloatware：Candy Crush, Clipchamp, Teams (consumer), Solitaire, News, Weather, People, Maps, Mixed Reality Portal
- [ ] `Get-AppxPackage | Remove-AppxPackage` 脚本化
- [ ] 阻止重新安装：`ContentDeliveryManager` 组策略

## 服务精简

- [ ] Print Spooler（不打印时关闭）
- [ ] Fax
- [ ] Xbox 系列：XblAuthManager, XblGameSave, XboxGipSvc, XboxNetApiSvc
- [ ] Phone Service, PhoneSvc
- [ ] Connected Devices Platform (CDPUserSvc)
- [ ] Retail Demo (RetailDemo)
- [ ] 远程桌面：SessionEnv, TermService, UmRdpService（不用时）

## 视觉效果

- [ ] `sysdm.cpl → 高级 → 性能 → 调整为最佳性能`
- [ ] 保留字体平滑和缩略图预览，其余关闭
- [ ] 关闭透明效果：设置 → 个性化 → 颜色

## 电源计划

- [ ] 启用 Ultimate Performance：`powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61`
- [ ] 台式机禁用 USB 选择性暂停

## 搜索索引

- [ ] 缩小索引范围：仅索引用户文件夹
- [ ] 或直接禁用 `WSearch` 服务（用 Everything 替代）

## 通知 / 建议 / Copilot

- [ ] 关闭 Tips & Suggestions
- [ ] 关闭锁屏 Spotlight
- [ ] 组策略关闭 Copilot / Cortana
- [ ] 关闭 Xbox Game Bar

## OneDrive

- [ ] 不用则卸载
- [ ] 禁止开机启动

## 网络

- [ ] TCP 自动调优级别：`netsh int tcp set global autotuninglevel=normal`
- [ ] DNS over HTTPS
- [ ] Nagle 算法（低延迟场景可关闭）

## NTFS

- [ ] 禁用 8.3 短文件名：`fsutil behavior set disable8dot3 1`
- [ ] 禁用 Last Access Timestamp：`fsutil behavior set disablelastaccess 1`

## Windows Update

- [ ] 推迟功能更新
- [ ] 限制传递优化带宽
- [ ] 禁用自动重启：Active Hours 或组策略

## Pagefile

- [ ] SSD 上固定大小（如物理内存的 1-1.5 倍）
- [ ] 避免动态扩展

## WSL 内存限制

- [ ] `%USERPROFILE%\.wslconfig` 设置 `memory=2GB`
