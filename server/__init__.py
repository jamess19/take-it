# Cấu hình log trước khi nạp các module khác, để log lúc khởi động (vd: chế độ lưu trữ) không bị mất
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
