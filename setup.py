from setuptools import setup


setup(
    name="aircheck-3d-simulator",
    version="1.0.0",
    description="AirCheck 3D digital-twin simulator",
    options={
        "build_apps": {
            "gui_apps": {
                "AirCheck 3D Simulator": "aircheck_simulator_3d/main.py",
            },
            "platforms": ["win_amd64"],
            "requirements_path": "aircheck_simulator_3d/requirements.txt",
            "include_patterns": ["aircheck_simulator_3d/config/*.toml"],
            "plugins": ["pandagl"],
            "log_filename": "$USER_APPDATA/AirCheck3D/panda.log",
            "log_append": True,
            "prefer_discrete_gpu": True,
        }
    },
)
