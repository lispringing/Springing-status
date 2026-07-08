# Debian Website Monitor

一个不依赖 Docker 和第三方 Python 包的网站监控面板，适合老 i386 Debian 服务器。

功能：

- 定期检测指定 HTTP/HTTPS 网站是否正常
- 本地端口展示网站状态、HTTP 状态码、响应耗时和最近错误
- 页面后台添加、启用、停用、删除监控站点
- 显示 Linux 服务器 CPU、内存、磁盘、负载和运行时间
- 配置和检测记录保存在本地 SQLite：`monitor.db`

## 本地运行

```bash
python3 app.py --host 127.0.0.1 --port 8080
```

然后访问：

```text
http://127.0.0.1:8080
```

后台默认密码：

```text
admin123
```

建议正式部署时修改密码：

```bash
export MONITOR_ADMIN_PASSWORD='换成你的强密码'
python3 app.py --host 0.0.0.0 --port 8080
```

## Debian 部署

假设项目放在：

```bash
/opt/debian-website-monitor
```

创建目录并复制文件：

```bash
sudo mkdir -p /opt/debian-website-monitor
sudo cp app.py README.md /opt/debian-website-monitor/
sudo chmod +x /opt/debian-website-monitor/app.py
```

直接启动：

```bash
cd /opt/debian-website-monitor
MONITOR_ADMIN_PASSWORD='换成你的强密码' python3 app.py --host 0.0.0.0 --port 8080
```

如果只想本机访问，保持 `--host 127.0.0.1`。如果要局域网或公网访问，用 `--host 0.0.0.0`，并在防火墙放行端口。

## systemd 后台运行

复制服务文件：

```bash
sudo cp systemd/debian-website-monitor.service /etc/systemd/system/
```

编辑服务文件里的密码和路径：

```bash
sudo nano /etc/systemd/system/debian-website-monitor.service
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now debian-website-monitor
sudo systemctl status debian-website-monitor
```

查看日志：

```bash
journalctl -u debian-website-monitor -f
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MONITOR_HOST` | `127.0.0.1` | 默认监听地址 |
| `MONITOR_PORT` | `8080` | 默认监听端口 |
| `MONITOR_DB` | `./monitor.db` | SQLite 数据库路径 |
| `MONITOR_ADMIN_PASSWORD` | `admin123` | 后台密码 |
| `MONITOR_SESSION_SECRET` | 随机值 | 登录 Cookie 签名密钥 |
| `MONITOR_CHECK_TIMEOUT` | `10` | 单次网站检测超时秒数 |

## 说明

默认判断规则：

- 如果配置了期望状态码，例如 `200`，则只有该状态码算正常
- 如果未配置期望状态码，则 `200` 到 `399` 算正常

老 Debian 如果没有 `python3`：

```bash
sudo apt-get update
sudo apt-get install python3
```
