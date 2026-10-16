#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
required = ['pubspec.yaml', 'lib/main.dart', 'lib/screens/wall_screen.dart', 'lib/services/said_here_service.dart', 'supabase/migrations/001_initial.sql', 'codemagic.yaml']
missing = [p for p in required if not (root / p).exists()]
if missing:
    print('Missing:', ', '.join(missing))
    sys.exit(1)

sql = (root / 'supabase/migrations/001_initial.sql').read_text()
for name in ['claim_wall_visit', 'get_discovered_wall', 'get_my_walls', 'create_wall_post', 'report_wall_post']:
    if not re.search(rf'create or replace function public\.{name}\b', sql):
        print('Missing function:', name)
        sys.exit(1)

service = (root / 'lib/services/said_here_service.dart').read_text()
for rpc in ['claim_wall_visit', 'get_discovered_wall', 'get_my_walls', 'create_wall_post', 'report_wall_post']:
    if rpc not in service:
        print('Client missing RPC:', rpc)
        sys.exit(1)

print('Repository structure and client/database contracts look consistent.')
