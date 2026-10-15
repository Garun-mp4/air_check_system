"""Nonblocking process lock; closing the file releases it on Linux and Windows."""
import os

def acquire(path):
    file = path.open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            if path.stat().st_size == 0:
                file.write(b'\0'); file.flush()
            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return file
    except OSError:
        file.close()
        raise BlockingIOError('Lock is held by another process')
