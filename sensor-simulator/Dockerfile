FROM python:3.12-slim

WORKDIR /app
COPY simulator.py .
COPY simulator_lease.py .
COPY test_simulator.py .
ENTRYPOINT ["python", "simulator.py"]

