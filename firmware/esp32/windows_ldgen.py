"""Run IDF's long linker-fragment command without cmd.exe's 8191-char limit.

PlatformIO 7.1.3 uses a shell string for ldgen, while ESP-IDF 6.1 supplies many
absolute fragment paths. Use the same arguments via CreateProcess (32K limit).
Other build actions and non-Windows builds retain their original behavior.
"""
import os
import subprocess

Import('env')  # noqa: F821 -- supplied by PlatformIO/SCons

if os.name == 'nt':
    original = env.VerboseAction

    def verbose_action(build_env, action, description):
        if not isinstance(action, str) or 'ldgen.py' not in action:
            return original(action, description)

        def direct_ldgen(target, source, env):
            import ctypes
            from ctypes import wintypes
            command = env.subst(action, target=target, source=source)
            count = ctypes.c_int()
            split = ctypes.windll.shell32.CommandLineToArgvW
            split.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
            split.restype = ctypes.POINTER(wintypes.LPWSTR)
            argv = split(command, ctypes.byref(count))
            if not argv:
                raise ctypes.WinError()
            try:
                args = [argv[index] for index in range(count.value)]
            finally:
                free = ctypes.windll.kernel32.LocalFree
                free.argtypes = [ctypes.c_void_p]
                free.restype = ctypes.c_void_p
                free(argv)
            return subprocess.call(args, env={str(key): str(value) for key, value in env['ENV'].items()})

        return build_env.Action(direct_ldgen, description)

    env.AddMethod(verbose_action, 'VerboseAction')
