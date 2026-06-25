#!/usr/bin/env python3
from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / "app.db"


def main() -> None:
    connection = sqlite3.connect(DB_PATH)
    cursor = connection.cursor()
    cursor.execute(
        """
        create table if not exists users (
            id integer primary key autoincrement,
            name text not null,
            email text not null,
            role text not null,
            active integer not null default 1
        )
        """
    )
    cursor.execute(
        """
        create table if not exists orders (
            id integer primary key autoincrement,
            user_id integer not null,
            total real not null,
            status text not null
        )
        """
    )

    cursor.execute("select count(*) from users")
    if cursor.fetchone()[0] == 0:
        cursor.executemany(
            "insert into users (name, email, role, active) values (?, ?, ?, ?)",
            [
                ("Ada", "ada@example.com", "admin", 1),
                ("Lin", "lin@example.com", "editor", 1),
                ("Ming", "ming@example.com", "viewer", 0),
            ],
        )
        cursor.executemany(
            "insert into orders (user_id, total, status) values (?, ?, ?)",
            [
                (1, 199.5, "paid"),
                (2, 88.0, "pending"),
                (1, 320.25, "paid"),
            ],
        )

    connection.commit()
    connection.close()
    print(f"Demo database ready: {DB_PATH}")


if __name__ == "__main__":
    main()
