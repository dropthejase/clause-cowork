import sys, os

sys.path.insert(0, os.path.dirname(__file__))

# Disable background extraction tasks during tests to prevent dangling asyncio tasks
os.environ.setdefault("TESTING", "1")
