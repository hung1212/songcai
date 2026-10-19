from pathlib import Path
import sqlite3, json, tempfile, time

root = Path('/Users/fangzehong/Library/Application Support/songcai-desktop')
def connect(file):
    # SQLite may create shared-memory files even for mode=ro. Work on a stable
    # temporary copy, including WAL if present, without touching the live DB.
    def capture():
        return {suffix: Path(str(file)+suffix).read_bytes() for suffix in ['', '-wal'] if Path(str(file)+suffix).exists()}
    for _ in range(8):
        before = capture(); after = capture()
        if before == after: break
        time.sleep(.1)
    else: raise RuntimeError('设置正在更新，请稍后重试')
    temp = tempfile.TemporaryDirectory(prefix='songcai-odds-read-')
    target = Path(temp.name) / 'settings.sqlite'
    for suffix, data in before.items(): Path(str(target)+suffix).write_bytes(data)
    db = sqlite3.connect(target); db.row_factory = sqlite3.Row
    return db, temp

spaces = [{'id':'default','name':'默认空间','archived':0}]; active = 'default'
if (root/'spaces.sqlite').exists():
    db,temp = connect(root/'spaces.sqlite')
    active = db.execute("SELECT value FROM meta WHERE key='active'").fetchone()[0]
    spaces = [dict(r) for r in db.execute('SELECT id,name,archived FROM spaces')]
    db.close();temp.cleanup()
result = {'date':'2026-10-15','activeSpaceId':active,'spaces':[]}
for space in spaces:
    file = root/'settlement.sqlite' if space['id']=='default' else root/'spaces'/space['id']/'settlement.sqlite'
    if not file.exists(): continue
    db,temp=connect(file);row=db.execute('SELECT revision,payload FROM settings WHERE id=1').fetchone()
    data=json.loads(row['payload']);rebates=data.get('rebates',{});unique=[]
    for value in rebates.values():
        setting={k:v for k,v in value.items() if k!='name'}
        if setting not in unique:unique.append(setting)
    result['spaces'].append({**space,'revision':row['revision'],'odds':data.get('odds'),'rebatePlayerCount':len(rebates),'rebateUniqueSettings':unique})
    db.close();temp.cleanup()
out=Path(__file__).parent/'settings.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False))
