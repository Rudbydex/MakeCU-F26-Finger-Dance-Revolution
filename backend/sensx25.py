"""Decode the SensX25 serial stream and match thumb pressure to a fingertip."""

from struct import unpack


HEADER = b"\xff\xff"
FRAME_LENGTH = 53


def crc8_maxim(payload):
    crc = 0
    for byte in payload:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0x8C if crc & 1 else crc >> 1
    return crc


class FrameDecoder:
    def __init__(self):
        self.buffer = bytearray()

    def feed(self, chunk):
        self.buffer.extend(chunk)
        while True:
            start = self.buffer.find(HEADER)
            if start < 0:
                # A sync word may span two serial reads.
                self.buffer[:] = self.buffer[-1:] if self.buffer.endswith(b"\xff") else b""
                return
            del self.buffer[:start]
            if len(self.buffer) < FRAME_LENGTH:
                return
            payload = self.buffer[2:52]
            if crc8_maxim(payload) != self.buffer[52]:
                del self.buffer[:1]
                continue
            del self.buffer[:FRAME_LENGTH]
            yield unpack(">25H", payload)


def is_centered(pixels, total):
    row = sum((index // 5) * value for index, value in enumerate(pixels))
    column = sum((index % 5) * value for index, value in enumerate(pixels))
    # The central 3×3 region is the same in the sensor's rotated wire order.
    return total <= row <= 3 * total and total <= column <= 3 * total


class ThumbSensor:
    def __init__(self, port, threshold):
        self.port = port
        self.threshold = threshold
        self.decoder = FrameDecoder()
        self.armed = False
        self.active_zone = None
        self.candidate_zone = None
        self.candidate_frames = 0

    def read(self, finger_zone):
        peak = None
        tap = None
        for pixels in self.decoder.feed(self.port.read_all()):
            total = sum(pixels)
            peak = total if peak is None else max(peak, total)
            if total <= self.threshold / 2:
                self.armed = True
                self.active_zone = None
            if not self.armed or total < self.threshold or finger_zone is None:
                self.candidate_zone = None
                self.candidate_frames = 0
                continue
            if finger_zone != self.candidate_zone:
                self.candidate_zone = finger_zone
                self.candidate_frames = 0
            self.candidate_frames += 1
            # Let the pad settle for a few frames before judging placement.
            if self.candidate_frames >= 3:
                self.armed = False
                self.active_zone = finger_zone
                tap = (finger_zone, is_centered(pixels, total))
        zone = self.active_zone if self.active_zone == finger_zone else None
        return peak, zone, tap
