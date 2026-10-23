"""AST-only calendar export checks. Never imports/starts the launcher or accesses user data."""
import ast
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any, Dict, Optional


def main() -> None:
    path = Path(__file__).resolve().parents[1] / "run_zeter_os.py"
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    names = {"event_text", "events_document_text", "events_csv_rows", "make_ics"}
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in nodes} == names
    namespace = {"datetime": datetime, "timezone": timezone, "re": re, "Any": Any, "Dict": Dict, "Optional": Optional}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), namespace)
    event = {"id": "event", "title": "Ёж; встреча, " * 15, "date": "2026-10-19", "endDate": "2026-10-20", "start": "23:30", "end": "01:00", "repeat": "weekly", "repeatInterval": 2, "repeatWeekdays": [1, 3], "repeatUntil": "2026-11-04", "excludedDates": ["2026-10-21"], "description": "строка 1\r\nстрока 2\\путь", "category": "calcat_focus", "taskId": "task", "projectId": "project", "projectName": "Проект", "attachments": [{"kind": "fs", "id": "note"}]}
    categories = [{"id": "calcat_focus", "name": "Фокус", "color": "#aabbcc"}]
    make_ics = namespace["make_ics"]
    raw = make_ics([event], categories)
    assert raw.endswith("\r\n")
    assert all(len(line.encode("utf-8")) <= 75 for line in raw.split("\r\n"))
    unfolded = raw.replace("\r\n ", "")
    for value in ["DTSTART:20261019T233000", "DTEND:20261020T010000", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO;UNTIL=20261104T235959", "EXDATE:20261021T233000", "CATEGORIES:Фокус", "X-ZETER-TASK-ID:task", "X-ZETER-PROJECT-ID:project", "DESCRIPTION:строка 1\\nстрока 2\\\\путь"]:
        assert value in unfolded, value
    assert "\\;" in unfolded and "\\," in unfolded
    assert "X-ZETER-ATTACHMENT:fs:note" in unfolded
    all_day = {**event, "allDay": True, "start": "", "end": ""}
    text = make_ics([all_day]).replace("\r\n ", "")
    assert "DTSTART;VALUE=DATE:20261019" in text
    assert "DTEND;VALUE=DATE:20261021" in text, "inclusive app end becomes exclusive ICS end"
    assert "UNTIL=20261104\r\n" in text and "EXDATE;VALUE=DATE:20261021" in text
    shifted = make_ics([{**event, "date": "2026-10-20", "endDate": "2026-10-21", "repeatWeekdays": [1]}]).replace("\r\n ", "")
    assert "DTSTART:20261102T233000" in shifted and "DTEND:20261103T010000" in shifted, "weekly DTSTART is a real selected weekday in the anchored interval"
    for repeat, expected in [("daily", "FREQ=DAILY;INTERVAL=2"), ("monthly", "FREQ=MONTHLY;INTERVAL=2")]:
        assert expected in make_ics([{**event, "repeat": repeat}])
    for end_date, start, expected_end, expected_minutes in [
        ("2027-01-04", "09:00", "20270104T100000", 60),
        ("2027-01-05", "09:00", "20270105T100000", 1500),
        ("2027-01-04", "23:30", "20270105T000000", 30),
        ("2027-01-05", "23:30", "20270106T000000", 1470),
    ]:
        draft = {"id": "missing_end", "date": "2027-01-04", "endDate": end_date, "start": start, "end": ""}
        exported = make_ics([draft]).replace("\r\n ", "")
        assert f"DTEND:{expected_end}\r\n" in exported, f"missing end must preserve model duration: {end_date}, {start}"
        begin = datetime.strptime(re.search(r"DTSTART:(\d{8}T\d{6})", exported).group(1), "%Y%m%dT%H%M%S")
        finish = datetime.strptime(re.search(r"DTEND:(\d{8}T\d{6})", exported).group(1), "%Y%m%dT%H%M%S")
        assert (finish - begin).total_seconds() / 60 == expected_minutes
    rows = namespace["events_csv_rows"]([event], categories)
    assert len(rows) == 2 and len(rows[0]) == len(rows[1]) == 20
    assert rows[1][:4] == [event["title"], "2026-10-19", "23:30", "01:00"]
    assert rows[1][9:19] == ["2026-10-20", "Нет", 2, "1,3", "2026-11-04", "2026-10-21", "task", "project", "Проект", "Фокус"]
    assert rows[1][19] == "fs:note"
    human = namespace["events_document_text"]([event], "Календарь", categories)
    for value in ["2026-10-20", "Интервал повтора: 2", "2026-10-21", "Фокус", "Задача: task", "Проект: Проект"]:
        assert value in human, value
    for invalid in [{"date": "2026-02-30"}, {"repeatWeekdays": [8]}, {"repeatInterval": 0.5}, {"excludedDates": ["bad"]}, {"start": "25:00"}]:
        try:
            make_ics([{**event, **invalid}])
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid metadata accepted: {list(invalid)}")
    assert raw.count("BEGIN:VEVENT") == 1
    print("calendar exports smoke: ok (AST only)")


if __name__ == "__main__":
    main()
