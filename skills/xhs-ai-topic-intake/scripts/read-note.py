"""Use installed Agent Reach, with a process-local Windows CMD argument fix."""
import json
import sys
from pathlib import Path

try:
    from agent_reach.runtime import run, tools
except ImportError:
    raise SystemExit("请使用已安装 agent-reach 的 Python 环境运行；本脚本不会自动安装或登录。")

original_run = run.run_cmd


def native_run(argv, **kwargs):
    if argv[0] == "opencli":
        executable = tools.resolve("opencli")
        if executable and Path(executable).suffix.lower() in (".cmd", ".bat"):
            package = Path(executable).parent / "node_modules" / "@jackwener" / "opencli"
            manifest = package / "package.json"
            if not manifest.is_file():
                raise SystemExit("未找到已安装 OpenCLI 的 Node 入口；停止，不修改工具。")
            entry = json.loads(manifest.read_text("utf-8"))["bin"]
            entry = entry["opencli"] if isinstance(entry, dict) else entry
            resolved_entry = (package / entry).resolve()
            if not resolved_entry.is_relative_to(package.resolve()):
                raise SystemExit("OpenCLI 入口超出已安装包目录，停止。")
            argv = [tools.resolve("node"), str(resolved_entry), *argv[1:]]
    return original_run(argv, **kwargs)


if __name__ == "__main__":
    if "--allow-network" not in sys.argv:
        raise SystemExit("默认不访问小红书。只有用户明确要求读取正文时才可加 --allow-network；一篇失败即停止。")
    sys.argv.remove("--allow-network")
    # This helper intentionally exposes only reading one supplied note.
    if len(sys.argv) < 4 or sys.argv[1:3] != ["xiaohongshu", "read"]:
        raise SystemExit("用法：python read-note.py xiaohongshu read <完整链接> [--timeout 45]")
    run.run_cmd = native_run
    from agent_reach.cli import main
    main()
