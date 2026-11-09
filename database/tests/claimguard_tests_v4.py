import psycopg2, random, sys, subprocess, json, os, pathlib
from psycopg2 import errors

if len(sys.argv) < 2:
    raise SystemExit("Usage: python claimguard_tests_v4.py claimguard_test_<yourname> [schema.sql] [--no-migrations]\n"
                     "Connection settings come from the standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).")
DB = sys.argv[1]
if not DB.startswith("claimguard_test_") or not DB.replace("_", "").isalnum():
    raise SystemExit("Safety stop: test database name must start with claimguard_test_ and contain only letters, digits, underscores. The runner recreates this database.")
ARGS = [a for a in sys.argv[2:] if not a.startswith("--")]
RUN_MIGRATIONS = "--no-migrations" not in sys.argv
DB_DIR = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = str(pathlib.Path(ARGS[0]).resolve()) if ARGS else str(DB_DIR / "schema" / "claimguard_schema_v4.sql")
if not pathlib.Path(SCHEMA).is_file():
    raise SystemExit(f"Schema file not found: {SCHEMA}")
# Migrations 001-004 are applied in order after the schema (the app and these tests need them).
MIGRATIONS = sorted((DB_DIR / "migrations").glob("[0-9][0-9][0-9]_*.sql")) if RUN_MIGRATIONS else []

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(cmd)}\n{p.stderr.strip()}")

# No shell=True: the DB name and file paths are passed as separate argv items.
run(["dropdb", "--if-exists", DB])
run(["createdb", DB])
for f in [SCHEMA, *map(str, MIGRATIONS)]:
    run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB, "-f", f])
print("applied:", ", ".join(pathlib.Path(f).name for f in [SCHEMA, *map(str, MIGRATIONS)]))

def conn():
    c = psycopg2.connect(dbname=DB); c.autocommit = False; return c
results = []
def rec(name, ok, detail=""):
    results.append((name, ok, detail)); print(("PASS " if ok else "FAIL ")+name+(" -- "+detail if detail and not ok else ""))

def vec(seed, dim=384):
    r = random.Random(seed); return "[" + ",".join(f"{r.uniform(-1,1):.5f}" for _ in range(dim)) + "]"

# ---- committed seed -------------------------------------------------------------
c = conn(); cur = c.cursor()
def q1(sql, a=()):
    cur.execute(sql, a); return cur.fetchone()[0]
def user(email, role):
    return q1("INSERT INTO app_user(role_id,email,password_hash,full_name) SELECT role_id,%s,'$argon2$x','Test' FROM app_role WHERE role_name=%s RETURNING user_id", (email, role))
H1 = user('h1@x.com','POLICYHOLDER'); H2 = user('h2@x.com','POLICYHOLDER')
ADJ = user('adj@x.com','CLAIMS_ADJUSTER'); ADJ_OFF = user('adjoff@x.com','CLAIMS_ADJUSTER'); ADM = user('adm@x.com','ADMIN')
cur.execute(
    "INSERT INTO risk_rule (rule_version, definition, is_active, created_by) VALUES (%s, %s::jsonb, %s, %s)",
    ("r1", json.dumps({"high_similarity_threshold": 0.9, "medium_similarity_threshold": 0.7}), True, ADM)
)
cur.execute("UPDATE app_user SET is_active=false WHERE user_id=%s",(ADJ_OFF,))
M1 = q1("INSERT INTO embedding_model(model_name,model_version,dimension) VALUES('m','1',384) RETURNING model_id")
M2 = q1("INSERT INTO embedding_model(model_name,model_version,dimension) VALUES('m','2',384) RETURNING model_id")
def pol(num, holder, active=True, eff="2026-01-01", exp="2027-12-31"):
    return q1("INSERT INTO policy(policy_number,holder_id,effective_date,expiry_date,is_active) VALUES(%s,%s,%s,%s,%s) RETURNING policy_id",(num,holder,eff,exp,active))
P1 = pol('P1',H1); P2 = pol('P2',H2); P_OFF = pol('P3',H1,active=False)
def refcase(seed, model=M1, confirmed=True):
    return q1("INSERT INTO reference_fraud_case(title,description,is_confirmed,embedding_model_id,embedding,created_by) VALUES('t','d',%s,%s,%s,%s) RETURNING case_id",(confirmed,model,vec(seed),ADM))
R = [refcase(i) for i in range(1,6)]
R_M2 = refcase(99, model=M2)
R_UNCONF = refcase(98, confirmed=False)
R_OFF = refcase(97)
cur.execute("UPDATE reference_fraud_case SET is_active=false, deactivated_at=now(), deactivated_by=%s WHERE case_id=%s",(ADM,R_OFF))
c.commit()

def newclaim(policy=P1, claimant=H1, amount=500, date="2026-06-01", desc="water damage", cur_=None):
    cc = cur_ or cur
    cc.execute("INSERT INTO claim(policy_id,claimant_id,incident_date,claimed_amount,description) VALUES(%s,%s,%s,%s,%s) RETURNING claim_id",(policy,claimant,date,amount,desc))
    return cc.fetchone()[0]

def expect_err(name, fn, code=None):
    """Run fn inside its own transaction; must raise (optionally with SQLSTATE) and roll back."""
    cc = conn(); k = cc.cursor()
    try:
        fn(k); cc.commit(); rec(name, False, "no error raised")
    except psycopg2.Error as e:
        cc.rollback()
        ok = code is None or e.pgcode == code
        rec(name, ok, f"got {e.pgcode} {str(e).splitlines()[0]}" if not ok else "")
    finally: cc.close()

def expect_ok(name, fn):
    cc = conn(); k = cc.cursor()
    try:
        out = fn(k); cc.commit(); rec(name, out is not False, "check returned False")
    except psycopg2.Error as e:
        cc.rollback(); rec(name, False, f"unexpected {e.pgcode} {str(e).splitlines()[0]}")
    finally: cc.close()

CHK, FK, RESTR = '23514','23503','23001'
def asmt(k, claim, attempt, status, **kw):
    d = dict(outcome=None, risk=None, rule=None, reason=None, model=None, emb=None, topk=None, metric=None); d.update(kw)
    k.execute("""INSERT INTO screening_assessment(claim_id,attempt_no,status,outcome,risk_indicator,risk_rule_version,failure_reason,embedding_model_id,description_embedding,top_k,similarity_metric)
                 VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING assessment_id""",
              (claim,attempt,status,d['outcome'],d['risk'],d['rule'],d['reason'],d['model'],d['emb'],d['topk'],d['metric']))
    return k.fetchone()[0]
def completed(k, claim, attempt=1, outcome='MATCHES_FOUND', topk=3):
    return asmt(k, claim, attempt, 'COMPLETED', outcome=outcome, risk='MEDIUM', rule='r1', model=M1, emb=vec(1000+attempt), topk=topk, metric='cosine')
def failed(k, claim, attempt=1):
    return asmt(k, claim, attempt, 'FAILED', reason='embedding service timeout')
def match(k, a, case, rank, score=0.8, model=M1):
    k.execute("INSERT INTO screening_match(assessment_id,reference_case_id,embedding_model_id,match_rank,similarity_score) VALUES(%s,%s,%s,%s,%s)",(a,case,model,rank,score))
def review(k, claim, action, rev=ADJ, assessment=None, notes='n'):
    k.execute("INSERT INTO review(claim_id,assessment_id,reviewer_id,review_action,notes) VALUES(%s,%s,%s,%s,%s) RETURNING review_id",(claim,assessment,rev,action,notes)); return k.fetchone()[0]
def decide(k, claim, rv, status):
    k.execute("INSERT INTO claim_decision(claim_id,review_id,decision_status) VALUES(%s,%s,%s)",(claim,rv,status))
def immediate(k): k.execute("SET CONSTRAINTS ALL IMMEDIATE")
def status_of(k, claim):
    k.execute("SELECT claim_status,screening_status FROM claim WHERE claim_id=%s",(claim,)); return k.fetchone()

print("== claims / domain constraints (FR-03, FR-13, AC-01, AC-02)")
def t_valid(k):
    cl = newclaim(cur_=k); return status_of(k, cl) == ('SUBMITTED','PENDING')
expect_ok("AC-01 valid claim stored as SUBMITTED/PENDING", t_valid)
expect_err("AC-02 negative amount rejected", lambda k: newclaim(amount=-5, cur_=k), CHK)
expect_err("AC-02 zero amount rejected", lambda k: newclaim(amount=0, cur_=k), CHK)
expect_err("AC-02 unknown policy rejected", lambda k: newclaim(policy='00000000-0000-0000-0000-000000000000', cur_=k), FK)
expect_err("BR-01 claimant must be policy holder", lambda k: newclaim(policy=P1, claimant=H2, cur_=k), FK)
expect_err("blank description rejected", lambda k: newclaim(desc='  ', cur_=k), CHK)
expect_err("inactive policy rejected", lambda k: newclaim(policy=P_OFF, cur_=k), CHK)
expect_err("incident before policy start rejected", lambda k: newclaim(date="2025-06-01", cur_=k), CHK)
expect_err("future incident date rejected", lambda k: newclaim(date="2027-06-01", cur_=k), CHK)
expect_err("claim inserted as DECIDED rejected", lambda k: k.execute("INSERT INTO claim(policy_id,claimant_id,incident_date,claimed_amount,description,claim_status) VALUES(%s,%s,'2026-06-01',5,'d','DECIDED')",(P1,H1)), CHK)
expect_err("claim inserted with COMPLETED screening rejected", lambda k: k.execute("INSERT INTO claim(policy_id,claimant_id,incident_date,claimed_amount,description,screening_status) VALUES(%s,%s,'2026-06-01',5,'d','COMPLETED')",(P1,H1)), CHK)

print("== claim state machine")
CL = newclaim(); c.commit()
expect_err("claim content immutable (amount update)", lambda k: k.execute("UPDATE claim SET claimed_amount=1 WHERE claim_id=%s",(CL,)), RESTR)
expect_err("direct screening_status update rejected", lambda k: k.execute("UPDATE claim SET screening_status='COMPLETED' WHERE claim_id=%s",(CL,)), RESTR)
expect_err("direct claim_status=DECIDED rejected", lambda k: k.execute("UPDATE claim SET claim_status='DECIDED' WHERE claim_id=%s",(CL,)), RESTR)
expect_ok("SUBMITTED -> UNDER_REVIEW allowed", lambda k: (k.execute("UPDATE claim SET claim_status='UNDER_REVIEW' WHERE claim_id=%s",(CL,)), status_of(k,CL)[0]=='UNDER_REVIEW')[1])
def t_back(k):
    k.execute("UPDATE claim SET claim_status='UNDER_REVIEW' WHERE claim_id=%s",(CL,))
    k.execute("UPDATE claim SET claim_status='SUBMITTED' WHERE claim_id=%s",(CL,))
expect_err("UNDER_REVIEW -> SUBMITTED rejected", t_back, CHK)

print("== roles and users")
expect_err("policy for non-policyholder rejected", lambda k: pol_k(k), CHK) if False else None
def t_pol_adj(k): k.execute("INSERT INTO policy(policy_number,holder_id,effective_date,expiry_date) VALUES('PX',%s,'2026-01-01','2027-01-01')",(ADJ,))
expect_err("policy held by adjuster rejected", t_pol_adj, CHK)
expect_err("review by policyholder rejected", lambda k: review(k, CL, 'REJECTED', rev=H1), CHK)
expect_err("review by inactive adjuster rejected", lambda k: review(k, CL, 'REJECTED', rev=ADJ_OFF), CHK)
expect_err("reference case by adjuster rejected", lambda k: k.execute("INSERT INTO reference_fraud_case(title,description,embedding_model_id,embedding,created_by) VALUES('t','d',%s,%s,%s)",(M1,vec(7),ADJ)), CHK)
expect_err("role change of user with policies rejected", lambda k: k.execute("UPDATE app_user SET role_id=(SELECT role_id FROM app_role WHERE role_name='ADMIN') WHERE user_id=%s",(H1,)), RESTR)
expect_err("duplicate email (case-insensitive) rejected", lambda k: user_k(k) if False else k.execute("INSERT INTO app_user(role_id,email,password_hash,full_name) VALUES(1,'H1@X.com','h','n')"), '23505')
expect_err("blank password_hash rejected", lambda k: k.execute("INSERT INTO app_user(role_id,email,password_hash,full_name) VALUES(1,'z@x.com',' ','n')"), CHK)

print("== embeddings / vectors")
expect_err("zero vector reference case rejected", lambda k: k.execute("INSERT INTO reference_fraud_case(title,description,embedding_model_id,embedding,created_by) VALUES('t','d',%s,array_fill(0,ARRAY[384])::vector,%s)",(M1,ADM)), CHK)
expect_err("wrong-dimension vector rejected", lambda k: k.execute("INSERT INTO reference_fraud_case(title,description,embedding_model_id,embedding,created_by) VALUES('t','d',%s,'[1,2,3]',%s)",(M1,ADM)))
expect_err("embedding_model dimension != 384 rejected", lambda k: k.execute("INSERT INTO embedding_model(model_name,model_version,dimension) VALUES('x','1',768)"), CHK)

print("== screening (FR-06/07, BR-07, AC-04, AC-05)")
def a(name_, fn, code=CHK): expect_err(name_, fn, code)
c1 = newclaim(); c.commit()
a("FAILED assessment with risk_indicator rejected (AC-05)", lambda k: asmt(k,c1,1,'FAILED',reason='x',risk='LOW'))
a("FAILED assessment with outcome rejected", lambda k: asmt(k,c1,1,'FAILED',reason='x',outcome='NO_MATCH'))
a("FAILED assessment without failure_reason rejected", lambda k: asmt(k,c1,1,'FAILED'))
a("COMPLETED assessment without risk_indicator rejected", lambda k: asmt(k,c1,1,'COMPLETED',outcome='NO_MATCH',rule='r',model=M1,emb=vec(1),topk=3,metric='cosine'))
a("COMPLETED assessment with zero vector rejected", lambda k: asmt(k,c1,1,'COMPLETED',outcome='NO_MATCH',risk='LOW',rule='r',model=M1,emb="["+",".join(["0"]*384)+"]",topk=3,metric='cosine'))
def t_failed(k):
    failed(k, c1, 1); return status_of(k, c1) == ('SUBMITTED','FAILED')
expect_ok("failed attempt sets claim.screening_status=FAILED (not low risk)", t_failed)
def t_failed_committed():
    k = cur; failed(k, c1, 1); c.commit()

a("duplicate attempt_no rejected", lambda k: failed(k, c1, 1), '23505')
def t_retry(k):
    aid = completed(k, c1, 2, topk=3)
    match(k, aid, R[0], 1, .9); match(k, aid, R[1], 2, .8)
    immediate(k); return status_of(k, c1)[1] == 'COMPLETED'
expect_ok("retry after failure: COMPLETED attempt 2 with ranked matches", t_retry)
def t_nomatch(k):
    c2 = newclaim(cur_=k); completed(k, c2, 1, outcome='NO_MATCH'); immediate(k)
    k.execute("SELECT screening_status, (SELECT outcome FROM screening_assessment WHERE claim_id=%s) FROM claim WHERE claim_id=%s",(c2,c2)); return k.fetchone()==('COMPLETED','NO_MATCH')
expect_ok("AC-04 explicit NO_MATCH completed state", t_nomatch)
def t_nomatch_with_match(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, outcome='NO_MATCH'); match(k, aid, R[0], 1)
a("NO_MATCH assessment with a match rejected", t_nomatch_with_match)
def t_no_matches(k):
    c2 = newclaim(cur_=k); completed(k, c2, 1); immediate(k)
a("MATCHES_FOUND with zero matches rejected at commit", t_no_matches)
def t_gap(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=5); match(k, aid, R[0], 1); match(k, aid, R[1], 3); immediate(k)
a("rank gap (1,3) rejected at commit", t_gap)
def t_rank_topk(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=2); match(k, aid, R[0], 3)
a("match_rank > top_k rejected", t_rank_topk)
def t_dup_case(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=3); match(k, aid, R[0], 1); match(k, aid, R[0], 2)
a("same reference case twice in one assessment rejected", t_dup_case, '23505')
def t_dup_rank(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=3); match(k, aid, R[0], 1); match(k, aid, R[1], 1)
a("duplicate rank rejected", t_dup_rank, '23505')
def t_cross_model(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=3); match(k, aid, R_M2, 1, model=M2)
a("cross-model match (model-2 case vs model-1 assessment) rejected", t_cross_model, FK)
def t_cross_model2(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=3); match(k, aid, R_M2, 1, model=M1)
a("match with mismatched case model rejected", t_cross_model2, FK)
def t_inactive(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=3); match(k, aid, R_OFF, 1)
a("BR-02 deactivated reference case cannot be matched", t_inactive)
def t_unconf(k):
    c2 = newclaim(cur_=k); aid = completed(k, c2, 1, topk=3); match(k, aid, R_UNCONF, 1)
a("BR-02 unconfirmed reference case cannot be matched", t_unconf)
# late match from another transaction
c3 = newclaim(); aid3 = completed(cur, c3, 1, topk=3); match(cur, aid3, R[0], 1); c.commit()
a("match added in a later transaction rejected", lambda k: match(k, aid3, R[1], 2))
def t_dup_claim_attempt_after_complete(k): failed(k, c3, 2)
a("new attempt after COMPLETED screening rejected", t_dup_claim_attempt_after_complete)

print("== review / approval guard / decision (FR-08/09/14, AC-06/07)")
# claim with pending screening
cp = newclaim(); c.commit()
a("AC-06 APPROVED review while screening PENDING rejected", lambda k: review(k, cp, 'APPROVED'))
# claim with failed screening
cf = newclaim(); failed(cur, cf, 1); c.commit()
a("AC-06 APPROVED review while screening FAILED rejected", lambda k: review(k, cf, 'APPROVED'))
# failed then completed claim: approval referencing the failed attempt
cm = newclaim(); fa = failed(cur, cm, 1); ca = completed(cur, cm, 2, topk=2); match(cur, ca, R[0], 1); c.commit()
a("APPROVED review citing the FAILED attempt rejected", lambda k: review(k, cm, 'APPROVED', assessment=fa))
a("APPROVED review without assessment rejected", lambda k: review(k, cm, 'APPROVED'))
a("review citing another claim's assessment rejected", lambda k: review(k, cm, 'REJECTED', assessment=aid3), FK)
a("blank review notes rejected", lambda k: review(k, cm, 'REJECTED', notes=' '))
expect_ok("REJECTED/INFO_REQUESTED review allowed while screening pending (documented A9)", lambda k: (review(k, cp, 'INFO_REQUESTED'), True)[1])
def t_decision_mismatch(k):
    rv = review(k, cm, 'REJECTED', assessment=ca); decide(k, cm, rv, 'APPROVED')
a("decision not mirroring review action rejected", t_decision_mismatch, FK)
def t_atomic_fail(k):
    rv = review(k, cp, 'REJECTED'); review(k, cp, 'APPROVED')
a("failed approval aborts whole transaction", t_atomic_fail)
cc = conn(); k = cc.cursor()
k.execute("SELECT count(*) FROM review WHERE claim_id=%s AND review_action='REJECTED'",(cp,)); n_rej = k.fetchone()[0]
rec("no partial review row left after rolled-back transaction", n_rej == 0, f"rejected reviews={n_rej}"); cc.close()
def t_full_flow(k):
    rv = review(k, cm, 'APPROVED', assessment=ca)
    decide(k, cm, rv, 'APPROVED')
    k.execute("INSERT INTO audit_log(actor_type,actor_id,action,claim_id,details) VALUES('USER',%s,'DECISION_RECORDED',%s,'{}')",(ADJ,cm))
    k.execute("SELECT claim_status FROM claim WHERE claim_id=%s",(cm,)); return k.fetchone()[0]=='DECIDED'
expect_ok("AC-07 valid approval: review+decision+audit commit, claim DECIDED", t_full_flow)
cc = conn(); k = cc.cursor(); k.execute("SELECT claim_status FROM claim WHERE claim_id=%s",(cm,)); st_=k.fetchone()[0]; cc.close()
rec("(same, re-read from a new session: committed)", st_=='DECIDED')
a("second decision on decided claim rejected", lambda k: decide(k, cm, review(k, cm, 'REJECTED', assessment=ca), 'REJECTED'))
a("review on decided claim rejected", lambda k: review(k, cm, 'INFO_REQUESTED'))
a("screening attempt on decided claim rejected", lambda k: failed(k, cm, 3))
a("decided claim cannot be reverted", lambda k: k.execute("UPDATE claim SET claim_status='UNDER_REVIEW' WHERE claim_id=%s",(cm,)), RESTR)
# review_required flip on decided claim
a("decided claim review_required immutable", lambda k: k.execute("UPDATE claim SET review_required=true WHERE claim_id=%s",(cm,)), RESTR)
# reject path on unscreened claim
def t_reject_flow(k):
    rv = review(k, cf, 'REJECTED'); decide(k, cf, rv, 'REJECTED')
    k.execute("SELECT claim_status,screening_status FROM claim WHERE claim_id=%s",(cf,)); return k.fetchone()==('DECIDED','FAILED')
expect_ok("rejection of a FAILED-screening claim keeps screening_status FAILED", t_reject_flow)

print("== append-only / no-delete (FR-10, NFR-02)")
cc = conn(); k = cc.cursor()
k.execute("INSERT INTO audit_log(actor_type,actor_id,action,claim_id) VALUES('USER',%s,'CLAIM_SUBMITTED',%s)",(H1,cm)); cc.commit(); cc.close()
for tbl, upd in [('audit_log',"UPDATE audit_log SET details='{}'"),('screening_assessment',"UPDATE screening_assessment SET top_k=9"),
                 ('screening_match',"UPDATE screening_match SET similarity_score=0"),('review',"UPDATE review SET notes='x'"),
                 ('claim_decision',"UPDATE claim_decision SET decision_status='REJECTED'")]:
    a(f"{tbl}: UPDATE rejected", lambda k, u=upd: k.execute(u), RESTR)
    a(f"{tbl}: DELETE rejected", lambda k, t=tbl: k.execute(f"DELETE FROM {t}"), RESTR)
    a(f"{tbl}: TRUNCATE CASCADE rejected", lambda k, t=tbl: k.execute(f"TRUNCATE {t} CASCADE"), RESTR)
for tbl in ['app_user','policy','claim','reference_fraud_case']:
    a(f"{tbl}: DELETE rejected", lambda k, t=tbl: k.execute(f"DELETE FROM {t}"), RESTR)
    a(f"{tbl}: TRUNCATE CASCADE rejected", lambda k, t=tbl: k.execute(f"TRUNCATE {t} CASCADE"), RESTR)
for tbl in ['audit_log','screening_match','claim_decision']:
    a(f"{tbl}: plain TRUNCATE rejected", lambda k, t=tbl: k.execute(f"TRUNCATE {t}"), RESTR)
a("TRUNCATE app_role CASCADE cannot wipe history", lambda k: k.execute("TRUNCATE app_role CASCADE"), RESTR)

print("== reference-case lifecycle (FR-11)")
RC = refcase(500); c.commit()
a("adjuster cannot deactivate a reference case", lambda k: k.execute("UPDATE reference_fraud_case SET is_active=false,deactivated_at=now(),deactivated_by=%s WHERE case_id=%s",(ADJ,RC)), CHK)
a("deactivation without actor rejected", lambda k: k.execute("UPDATE reference_fraud_case SET is_active=false,deactivated_at=now() WHERE case_id=%s",(RC,)), CHK)
a("reference-case embedding immutable", lambda k: k.execute("UPDATE reference_fraud_case SET embedding=%s WHERE case_id=%s",(vec(1),RC)), RESTR)
a("reactivation rejected", lambda k: k.execute("UPDATE reference_fraud_case SET is_active=true,deactivated_at=NULL,deactivated_by=NULL WHERE case_id=%s",(R_OFF,)), RESTR)
a("deactivation record cannot be rewritten", lambda k: k.execute("UPDATE reference_fraud_case SET deactivated_at=now()-interval '5 years' WHERE case_id=%s",(R_OFF,)), RESTR)
expect_ok("admin deactivation allowed", lambda k: (k.execute("UPDATE reference_fraud_case SET is_active=false,deactivated_at=now(),deactivated_by=%s WHERE case_id=%s",(ADM,RC)), True)[1])

print("== audit log constraints")
def au(k, actor_type, actor, action, **t):
    cols = dict(claim_id=None, reference_case_id=None, target_user_id=None, assessment_id=None); cols.update(t)
    k.execute("INSERT INTO audit_log(actor_type,actor_id,action,claim_id,reference_case_id,target_user_id,assessment_id) VALUES(%s,%s,%s,%s,%s,%s,%s)",(actor_type,actor,action,cols['claim_id'],cols['reference_case_id'],cols['target_user_id'],cols['assessment_id']))
a("audit: two targets rejected", lambda k: au(k,'USER',ADM,'CLAIM_SUBMITTED',claim_id=c1,target_user_id=H1))
a("audit: no target rejected", lambda k: au(k,'USER',ADM,'CLAIM_SUBMITTED'))
a("audit: action/target mismatch rejected", lambda k: au(k,'USER',ADM,'CLAIM_SUBMITTED',target_user_id=H1))
a("audit: USER without actor rejected", lambda k: au(k,'USER',None,'CLAIM_SUBMITTED',claim_id=c1))
a("audit: SYSTEM with actor rejected", lambda k: au(k,'SYSTEM',ADM,'CLAIM_SUBMITTED',claim_id=c1))
a("audit: unknown action rejected", lambda k: au(k,'SYSTEM',None,'HACKED',claim_id=c1))
a("audit: assessment of a different claim rejected", lambda k: au(k,'SYSTEM',None,'REVIEW_RECORDED',claim_id=c1,assessment_id=aid3), FK)
a("audit: assessment without claim rejected", lambda k: au(k,'SYSTEM',None,'USER_CREATED',target_user_id=H1,assessment_id=aid3))
def t_trigger_audit(k):
    k.execute("SELECT count(*) FROM audit_log WHERE assessment_id=%s AND action='SCREENING_COMPLETED'",(aid3,))
    return k.fetchone()[0] == 1
expect_ok("assessment insert automatically writes exactly one screening audit event", t_trigger_audit)
a("duplicate SCREENING_COMPLETED for same attempt rejected", lambda k: au(k,'SYSTEM',None,'SCREENING_COMPLETED',claim_id=c3,assessment_id=aid3), '23505')
def t_two_reviews(k):
    for _ in range(2): au(k,'USER',ADJ,'REVIEW_RECORDED',claim_id=cm,assessment_id=ca)
expect_ok("audit: several REVIEW_RECORDED rows may cite one assessment", lambda k: (t_two_reviews(k), True)[1])
expect_ok("audit: reference-case and user events accepted", lambda k: (au(k,'USER',ADM,'REFERENCE_CASE_DEACTIVATED',reference_case_id=RC), au(k,'USER',ADM,'USER_STATUS_CHANGED',target_user_id=ADJ_OFF), True)[2])

print("== views (FR-12)")
cv = newclaim(); failed(cur, cv, 1); c.commit()
def t_views(k):
    k.execute("SELECT latest_attempt_status, risk_indicator, outcome, screening_status FROM v_review_queue WHERE claim_id=%s",(cv,)); r1 = k.fetchone()
    k.execute("SELECT count(*) FROM v_review_queue WHERE claim_status='DECIDED'"); dec = k.fetchone()[0]
    k.execute("SELECT sum(claim_count) FROM v_claim_status_summary"); tot = k.fetchone()[0]
    k.execute("SELECT count(*) FROM claim"); n = k.fetchone()[0]
    k.execute("SELECT count(*) FROM v_review_queue"); q = k.fetchone()[0]
    k.execute("SELECT count(*) FROM claim WHERE claim_status<>'DECIDED'"); qn = k.fetchone()[0]
    return r1 == ('FAILED', None, None, 'FAILED') and dec == 0 and tot == n and q == qn
expect_ok("queue shows failed attempt with NULL risk; no decided rows; summary total = claim count", t_views)

print("== HNSW / pgvector (NFR-06)")
cc = conn(); k = cc.cursor()
k.execute("""INSERT INTO reference_fraud_case(title,description,embedding_model_id,embedding,created_by)
             SELECT 't'||g,'d',%s,(SELECT array_agg(random()*2-1) FROM generate_series(1,384) WHERE g>0)::vector,%s FROM generate_series(1,3000) g""",(M1,ADM))
cc.commit(); k.execute("ANALYZE reference_fraud_case")
qv = vec(4242)
k.execute("EXPLAIN SELECT case_id FROM reference_fraud_case WHERE is_active AND is_confirmed AND embedding_model_id=%s ORDER BY embedding <=> %s LIMIT 5",(M1,qv))
plan = "\n".join(r[0] for r in k.fetchall())
print("   plan nodes:", [l.strip()[:90] for l in plan.splitlines() if 'Scan' in l or 'Filter' in l])
rec("top-k query uses ix_ref_case_embedding_hnsw at ~3000 rows", "ix_ref_case_embedding_hnsw" in plan)
def topk(qv, off, ef):
    k.execute(f"SET hnsw.ef_search={ef}")
    if off: k.execute("SET enable_indexscan=off")
    else: k.execute("SET enable_indexscan=on")
    k.execute("SELECT case_id FROM reference_fraud_case WHERE is_active AND is_confirmed AND embedding_model_id=%s ORDER BY embedding <=> %s LIMIT 5",(M1,qv))
    return [r[0] for r in k.fetchall()]
nq=30; rec5={40:0,200:0}; full=True
for i in range(nq):
    qv = vec(9000+i); ex = set(topk(qv, True, 40))
    for ef in (40,200):
        got = topk(qv, False, ef); full &= (len(got)==5); rec5[ef]+=len(ex & set(got))/5
rec("HNSW top-k returns k=5 rows for all 30 queries", full)
print(f"   MEASURED recall@5 vs exact scan, {nq} random queries on 3000 uniform-random 384-d vectors: ef_search=40 -> {rec5[40]/nq:.2f}; ef_search=200 -> {rec5[200]/nq:.2f}")
cc.close()


print("== SRS v2.0 extensions (risk rules, responses, notifications, search, reports)")
def t_extensions(k):
    # Add a versioned configurable rule; thresholds are data, not hard-coded in the function.
    k.execute("UPDATE risk_rule SET is_active=false WHERE is_active=true")
    k.execute("INSERT INTO risk_rule(rule_version,definition,is_active,created_by) VALUES('test-rule-v1',%s,true,%s)",
              (json.dumps({"high_similarity_threshold":0.90,"medium_similarity_threshold":0.70}), ADM))
    cl = newclaim(cur_=k)
    # notification is soft-dismissed, never deleted; own-user filtering is an application authorization rule.
    k.execute("INSERT INTO notification(user_id,claim_id,notification_type,message) VALUES(%s,%s,'CLAIM_UPDATE','Claim received') RETURNING notification_id",(H1,cl))
    nid=k.fetchone()[0]
    k.execute("UPDATE notification SET read_at=now(),dismissed_at=now() WHERE notification_id=%s",(nid,))
    k.execute("SELECT dismissed_at IS NOT NULL FROM notification WHERE notification_id=%s",(nid,))
    dismissed=k.fetchone()[0]
    k.execute("SELECT count(*) FROM v_risk_distribution_over_time")
    k.fetchone()
    k.execute("SELECT count(*) FROM v_reference_match_frequency")
    k.fetchone()
    k.execute("SELECT count(*) FROM v_adjuster_workload")
    k.fetchone()
    k.execute("SELECT count(*) FROM v_high_risk_aged_queue")
    k.fetchone()
    k.execute("SELECT count(*) FROM v_stale_pending_screening")
    k.fetchone()
    k.execute("SELECT count(*) FROM claim WHERE to_tsvector('english',description) @@ plainto_tsquery('english','water damage')")
    return dismissed
expect_ok("versioned rule, notification soft dismissal and analytics/search views are queryable", t_extensions)
a("notification content cannot be rewritten", lambda k: k.execute("UPDATE notification SET message='tampered'"), RESTR)
a("notification cannot be deleted", lambda k: k.execute("DELETE FROM notification"), RESTR)
expect_err("information response with blank body is rejected", lambda k: k.execute("INSERT INTO information_response(review_id,claim_id,responder_id,body) VALUES(gen_random_uuid(),gen_random_uuid(),%s,' ')",(H1,)))

# =====================================================================================
# Migrations 002-004 (skipped with --no-migrations)
# =====================================================================================
class Check(Exception):
    pass

def need(cond, msg):
    if not cond:
        raise Check(msg)

def scenario(name, fn, commit=True):
    """Run fn(k) in its own transaction. Asserts use need(); commit=False always rolls back."""
    cc = conn(); k = cc.cursor()
    try:
        fn(k)
        cc.commit() if commit else cc.rollback()
        rec(name, True)
    except Check as e:
        cc.rollback(); rec(name, False, str(e))
    except psycopg2.Error as e:
        cc.rollback(); rec(name, False, f"unexpected {e.pgcode} {str(e).splitlines()[0]}")
    finally:
        cc.close()

def expect_err_msg(name, fn, code, text):
    """Like expect_err, but the error message must also contain `text`."""
    cc = conn(); k = cc.cursor()
    try:
        fn(k); cc.commit(); rec(name, False, "no error raised")
    except psycopg2.Error as e:
        cc.rollback()
        ok = e.pgcode == code and text in str(e)
        rec(name, ok, "" if ok else f"got {e.pgcode} {str(e).splitlines()[0]}")
    finally:
        cc.close()

def one(k, sql, args=()):
    k.execute(sql, args); return k.fetchone()

def screen(k, claim, emb, topk=3, reason=None, model=M1):
    """CALL sp_screen_claim; returns (assessment_id, status, risk_indicator)."""
    k.execute("CALL sp_screen_claim(%s, %s, %s::vector, %s, %s, NULL, NULL, NULL)", (claim, model, emb, topk, reason))
    return k.fetchone()

def decide_sp(k, claim, reviewer, action, notes="adjuster notes for the test"):
    """CALL sp_decide_claim; returns (review_id, decision_id, notification_id)."""
    k.execute("CALL sp_decide_claim(%s, %s, %s, %s, NULL, NULL, NULL)", (claim, reviewer, action, notes))
    return k.fetchone()

def counts(k, claim):
    return one(k, """SELECT (SELECT count(*) FROM review WHERE claim_id=%(c)s),
                            (SELECT count(*) FROM claim_decision WHERE claim_id=%(c)s),
                            (SELECT count(*) FROM notification WHERE claim_id=%(c)s),
                            (SELECT count(*) FROM audit_log WHERE claim_id=%(c)s),
                            (SELECT claim_status FROM claim WHERE claim_id=%(c)s)""", {"c": claim})

if MIGRATIONS:
    ACTIVE_RULE = q1("SELECT rule_version FROM risk_rule WHERE is_active")   # 'test-rule-v1' (0.90 / 0.70)

    print("== migration 002: risk-rule foreign key (BR-06, FR-07)")
    expect_err("FK: assessment citing an unknown risk_rule version rejected",
               lambda k: asmt(k, newclaim(cur_=k), 1, 'COMPLETED', outcome='NO_MATCH', risk='LOW', rule='no-such-rule',
                              model=M1, emb=vec(1), topk=3, metric='cosine'), FK)
    expect_err("FK: a risk_rule used by an assessment cannot be deleted",
               lambda k: k.execute("DELETE FROM risk_rule WHERE rule_version='r1'"), FK)
    expect_err("FK: a used rule_version cannot be renamed",
               lambda k: k.execute("UPDATE risk_rule SET rule_version='r1-renamed' WHERE rule_version='r1'"), FK)

    print("== migration 002: sp_screen_claim (FR-05/06/07/14/16, AC-04/05/10/11)")
    HIGH_CLAIM = []      # filled by the next scenario, used by the HIGH-risk workflow tests
    def t_screen_completed(k):
        cl = newclaim(cur_=k, desc="screen me"); HIGH_CLAIM.append(cl)
        aid, st, risk = screen(k, cl, vec(1))        # vec(1) is R[0]'s embedding -> similarity 1.0
        need(st == 'COMPLETED', f"status {st}")
        n, top_case, top_sim, min_rank, max_rank = one(k, """
            SELECT count(*), (array_agg(reference_case_id ORDER BY match_rank))[1],
                   max(similarity_score), min(match_rank), max(match_rank)
            FROM screening_match WHERE assessment_id=%s""", (aid,))
        need(n == 3 and min_rank == 1 and max_rank == 3, f"{n} matches, ranks {min_rank}..{max_rank}")
        need(top_case == R[0] and top_sim > 0.999, f"rank 1 = {top_case} sim {top_sim}")
        outcome, stored_risk, rule = one(k, "SELECT outcome, risk_indicator, risk_rule_version FROM screening_assessment WHERE assessment_id=%s", (aid,))
        need(outcome == 'MATCHES_FOUND' and stored_risk == risk == 'HIGH', f"{outcome} {stored_risk} {risk}")
        need(rule == ACTIVE_RULE, f"rule {rule}")
        need(q1_k(k, "SELECT fn_compute_claim_risk(%s, %s)", (aid, rule)) == 'HIGH', "fn_compute_claim_risk disagrees")
        need(one(k, "SELECT screening_status, review_required FROM claim WHERE claim_id=%s", (cl,)) == ('COMPLETED', True),
             "claim not COMPLETED/review_required")
        need(q1_k(k, "SELECT count(*) FROM audit_log WHERE assessment_id=%s AND action='SCREENING_COMPLETED'", (aid,)) == 1,
             "missing SCREENING_COMPLETED audit row")
    def q1_k(k, sql, args=()):
        k.execute(sql, args); return k.fetchone()[0]
    scenario("COMPLETED: 3 ranked matches, risk from active rule = fn_compute_claim_risk, HIGH sets review_required, audited",
             t_screen_completed)

    FAILED_CLAIM = []
    def t_screen_failed(k):
        cl = newclaim(cur_=k, desc="service down"); FAILED_CLAIM.append(cl)
        aid, st, risk = screen(k, cl, None, reason="embedding service timeout")
        need(st == 'FAILED' and risk is None, f"{st} {risk}")
        row = one(k, "SELECT outcome, risk_indicator, risk_rule_version, failure_reason FROM screening_assessment WHERE assessment_id=%s", (aid,))
        need(row[:3] == (None, None, None) and row[3] == "embedding service timeout", f"row {row}")
        need(q1_k(k, "SELECT count(*) FROM screening_match WHERE assessment_id=%s", (aid,)) == 0, "matches stored")
        need(q1_k(k, "SELECT screening_status FROM claim WHERE claim_id=%s", (cl,)) == 'FAILED', "claim not FAILED")
        need(q1_k(k, "SELECT count(*) FROM audit_log WHERE assessment_id=%s AND action='SCREENING_FAILED'", (aid,)) == 1, "no audit")
    scenario("AC-05 service failure stored as FAILED: no outcome, no risk, no rule, no matches (never LOW)", t_screen_failed)

    def t_screen_bad_dim(k):
        cl = newclaim(cur_=k)
        aid, st, risk = screen(k, cl, "[0.1,0.2,0.3]")
        reason = q1_k(k, "SELECT failure_reason FROM screening_assessment WHERE assessment_id=%s", (aid,))
        need(st == 'FAILED' and risk is None and "dimensions" in reason, f"{st} {risk} {reason}")
    scenario("wrong-dimension embedding becomes a FAILED attempt with the error as reason, not LOW", t_screen_bad_dim, commit=False)

    def t_screen_no_rule(k):
        k.execute("UPDATE risk_rule SET is_active=false")
        cl = newclaim(cur_=k)
        aid, st, risk = screen(k, cl, vec(3))
        reason = q1_k(k, "SELECT failure_reason FROM screening_assessment WHERE assessment_id=%s", (aid,))
        need(st == 'FAILED' and risk is None and "no active risk rule" in reason, f"{st} {risk} {reason}")
        need(q1_k(k, "SELECT count(*) FROM screening_match m JOIN screening_assessment a USING (assessment_id) WHERE a.claim_id=%s", (cl,)) == 0,
             "partial matches left behind")
    scenario("no active risk rule: attempt FAILED and the partial COMPLETED work is rolled back", t_screen_no_rule, commit=False)

    def t_new_rule_version(k):
        k.execute("UPDATE risk_rule SET is_active=false WHERE is_active")
        k.execute("INSERT INTO risk_rule(rule_version,definition,is_active,created_by) VALUES('test-rule-v2',%s,true,%s)",
                  (json.dumps({"high_similarity_threshold": 0.99, "medium_similarity_threshold": 0.98}), ADM))
        cl = newclaim(cur_=k)
        aid, st, risk = screen(k, cl, vec(1))
        need(one(k, "SELECT risk_rule_version FROM screening_assessment WHERE assessment_id=%s", (aid,))[0] == 'test-rule-v2', "new version not recorded")
        old = q1_k(k, "SELECT risk_rule_version FROM screening_assessment WHERE claim_id=%s", (HIGH_CLAIM[0],))
        need(old == ACTIVE_RULE, f"older assessment changed to {old}")
    scenario("AC-11 new rule version: new assessment records it, older assessment keeps its version", t_new_rule_version, commit=False)

    expect_err("screening a decided claim rejected", lambda k: screen(k, cm, vec(5)), CHK)
    expect_err("screening a claim that already has a COMPLETED attempt rejected", lambda k: screen(k, HIGH_CLAIM[0], vec(5)), CHK)

    def t_retry(k):
        aid, st, risk = screen(k, FAILED_CLAIM[0], vec(2))
        need(st == 'COMPLETED', st)
        need(q1_k(k, "SELECT attempt_no FROM screening_assessment WHERE assessment_id=%s", (aid,)) == 2, "attempt_no is not 2")
    scenario("FR-22 retry after FAILED: next attempt_no, COMPLETED", t_retry)

    print("== migration 002: sp_decide_claim atomicity (FR-08/09/10, AC-06/07)")
    CF2 = newclaim(desc="decide me"); failed(cur, CF2, 1); c.commit()
    k0 = conn(); kk = k0.cursor(); BEFORE = counts(kk, CF2); k0.close()
    expect_err_msg("AC-06 APPROVED with FAILED screening refused by fn_assert_approvable",
                   lambda k: decide_sp(k, CF2, ADJ, 'APPROVED'), CHK, "screening status is FAILED")
    k0 = conn(); kk = k0.cursor(); AFTER = counts(kk, CF2); k0.close()
    rec("guard failure leaves no review, decision, notification or audit row (counts unchanged)", BEFORE == AFTER, f"{BEFORE} -> {AFTER}")
    expect_err("REJECTED by an inactive adjuster refused (review role trigger)",
               lambda k: decide_sp(k, CF2, ADJ_OFF, 'REJECTED'), CHK)
    k0 = conn(); kk = k0.cursor(); AFTER2 = counts(kk, CF2); k0.close()
    rec("the procedure's earlier SUBMITTED->UNDER_REVIEW update was rolled back too", AFTER2 == BEFORE, f"{BEFORE} -> {AFTER2}")
    def t_decide_ok(k):
        rv, dec, note = decide_sp(k, CF2, ADJ, 'REJECTED')
        need(rv and dec and note, "missing ids")
        rv_n, dec_n, note_n, audit_n, status = counts(k, CF2)
        need((rv_n, dec_n, note_n, status) == (BEFORE[0] + 1, BEFORE[1] + 1, BEFORE[2] + 1, 'DECIDED'), f"counts {rv_n},{dec_n},{note_n},{status}")
        need(q1_k(k, "SELECT notification_type FROM notification WHERE notification_id=%s", (note,)) == 'CLAIM_REJECTED', "wrong notification")
        need(q1_k(k, "SELECT user_id FROM notification WHERE notification_id=%s", (note,)) == H1, "not sent to the policyholder")
        acts = {r[0] for r in (k.execute("SELECT action FROM audit_log WHERE claim_id=%s", (CF2,)) or k.fetchall())}
        need({'REVIEW_RECORDED', 'DECISION_RECORDED'} <= acts, f"audit actions {acts}")
    scenario("AC-07 REJECTED: review + decision + policyholder notification + audit rows, claim DECIDED", t_decide_ok)

    print("== migration 004: HIGH-risk approval and information responses (FR-09/18, BR-08, AC-06/12)")
    CH = HIGH_CLAIM[0]
    def t_direct_insert_blocked(k):
        cl = newclaim(cur_=k); aid, st, risk = screen(k, cl, vec(2))   # R[1] -> HIGH
        need(risk == 'HIGH', f"risk {risk}")
        review(k, cl, 'APPROVED', assessment=aid)
    expect_err_msg("HIGH-risk approval by direct review INSERT is blocked too (trg_review_guard)",
                   t_direct_insert_blocked, CHK, "needs an information request")
    expect_err_msg("HIGH-risk APPROVED before any information request refused",
                   lambda k: decide_sp(k, CH, ADJ, 'APPROVED'), CHK, "needs an information request")
    REQ = []
    def t_request(k):
        rv, dec, note = decide_sp(k, CH, ADJ, 'INFO_REQUESTED', "Please send the repair invoice.")
        REQ.append(rv)
        need(dec is None, "decision created")
        need(q1_k(k, "SELECT claim_status FROM claim WHERE claim_id=%s", (CH,)) == 'AWAITING_INFO', "not AWAITING_INFO")
        need(q1_k(k, "SELECT notification_type FROM notification WHERE notification_id=%s", (note,)) == 'INFO_REQUESTED', "no notification")
    scenario("INFO_REQUESTED: claim AWAITING_INFO, policyholder notified, no decision", t_request)
    expect_err_msg("HIGH-risk APPROVED while the request is unanswered refused",
                   lambda k: decide_sp(k, CH, ADJ, 'APPROVED'), CHK, "still unanswered")
    def respond(k, review_id, responder, claim=CH, body="Invoice attached."):
        k.execute("INSERT INTO information_response(review_id,claim_id,responder_id,body) VALUES(%s,%s,%s,%s) RETURNING response_id",
                  (review_id, claim, responder, body)); return k.fetchone()[0]
    expect_err_msg("another policyholder cannot answer the request",
                   lambda k: respond(k, REQ[0], H2), CHK, "only the policyholder who submitted this claim")
    other_review = q1("SELECT review_id FROM review WHERE claim_id=%s AND review_action='INFO_REQUESTED'", (cp,))
    expect_err_msg("answering a review that is not this claim's latest open request refused",
                   lambda k: respond(k, other_review, H1), CHK, "no outstanding information request")
    def t_answer(k):
        respond(k, REQ[0], H1)
        need(q1_k(k, "SELECT claim_status FROM claim WHERE claim_id=%s", (CH,)) == 'UNDER_REVIEW', "claim not back to UNDER_REVIEW")
        need(q1_k(k, "SELECT count(*) FROM notification WHERE claim_id=%s AND user_id=%s AND notification_type='INFO_RECEIVED'", (CH, ADJ)) == 1,
             "adjuster not notified")
        need(q1_k(k, "SELECT count(*) FROM audit_log WHERE claim_id=%s AND action='INFORMATION_RESPONSE_ADDED'", (CH,)) == 1, "no audit row")
    scenario("AC-12 policyholder answers: claim AWAITING_INFO -> UNDER_REVIEW, adjuster notified, audited", t_answer)
    expect_err_msg("answering the same request twice refused", lambda k: respond(k, REQ[0], H1, body="again"), CHK, "")
    def t_approve(k):
        rv, dec, note = decide_sp(k, CH, ADJ, 'APPROVED', "Invoice verified.")
        need(dec is not None, "no decision")
        need(one(k, "SELECT claim_status, (SELECT decision_status FROM claim_decision WHERE claim_id=%s) FROM claim WHERE claim_id=%s", (CH, CH))
             == ('DECIDED', 'APPROVED'), "not DECIDED/APPROVED")
    scenario("HIGH-risk APPROVED after the answer is accepted", t_approve)

    print("== migration 003: reference-case versioning (FR-11)")
    RV0 = refcase(600); c.commit()
    VERS = [RV0]
    def revise(k, case, admin=ADM, emb_seed=601):
        k.execute("CALL sp_revise_reference_case(%s,%s,%s,%s,%s,%s::vector,NULL)", (case, admin, 'revised title', 'revised description text', M1, vec(emb_seed)))
        return k.fetchone()[0]
    def t_revise(k):
        new = revise(k, RV0); VERS.append(new)
        old = one(k, "SELECT is_active, deactivated_by FROM reference_fraud_case WHERE case_id=%s", (RV0,))
        need(old == (False, ADM), f"old row {old}")
        need(one(k, "SELECT is_active, supersedes_case_id FROM reference_fraud_case WHERE case_id=%s", (new,)) == (True, RV0), "new row not linked")
        acts = {r[0] for r in (k.execute("SELECT action FROM audit_log WHERE reference_case_id IN (%s,%s)", (RV0, new)) or k.fetchall())}
        need({'REFERENCE_CASE_ADDED', 'REFERENCE_CASE_DEACTIVATED'} <= acts, f"audit {acts}")
    scenario("revision deactivates the old row and inserts a linked active version, both audited", t_revise)
    def t_chain(k):
        newest = revise(k, VERS[-1], emb_seed=602)
        expected = [newest, *reversed(VERS)]
        k.execute("""WITH RECURSIVE chain AS (
                        SELECT case_id, supersedes_case_id, 1 AS depth FROM reference_fraud_case WHERE case_id=%s
                        UNION ALL
                        SELECT r.case_id, r.supersedes_case_id, c.depth + 1
                        FROM reference_fraud_case r JOIN chain c ON r.case_id = c.supersedes_case_id)
                     SELECT case_id FROM chain ORDER BY depth""", (newest,))
        chain = [r[0] for r in k.fetchall()]
        need(chain == expected, f"chain {chain}")
        need(q1_k(k, "SELECT count(*) FROM reference_fraud_case WHERE case_id = ANY(%s::uuid[]) AND is_active", (expected,)) == 1,
             "more than one active version")
        VERS.append(newest)   # only once every check passed (the transaction commits next)
    scenario("second revision: WITH RECURSIVE walks newest -> oldest, exactly one version active", t_chain)
    expect_err_msg("revising an inactive (superseded) version refused", lambda k: revise(k, RV0), CHK, "inactive")
    expect_err("revision by a claims adjuster refused (deactivator must be ADMIN)", lambda k: revise(k, VERS[-1], admin=ADJ), CHK)
    expect_err("supersedes_case_id is immutable", lambda k: k.execute("UPDATE reference_fraud_case SET supersedes_case_id=NULL WHERE case_id=%s", (VERS[1],)), RESTR)
    expect_err("a new version cannot supersede a still-active case",
               lambda k: k.execute("INSERT INTO reference_fraud_case(title,description,embedding_model_id,embedding,created_by,supersedes_case_id) VALUES('t','d',%s,%s,%s,%s)",
                                   (M1, vec(603), ADM, VERS[-1])), CHK)
    expect_err("two versions cannot supersede the same case",
               lambda k: k.execute("INSERT INTO reference_fraud_case(title,description,embedding_model_id,embedding,created_by,supersedes_case_id) VALUES('t','d',%s,%s,%s,%s)",
                                   (M1, vec(604), ADM, RV0)), '23505')

    print("== migrations 001/004: users and sessions (FR-01/02, NFR-01)")
    expect_err_msg("the last active admin cannot be deactivated",
                   lambda k: k.execute("UPDATE app_user SET is_active=false WHERE user_id=%s", (ADM,)), CHK, "last active administrator")
    def t_second_admin(k):
        adm2 = q1_k(k, "INSERT INTO app_user(role_id,email,password_hash,full_name) SELECT role_id,'adm2@x.com','h','Admin Two' FROM app_role WHERE role_name='ADMIN' RETURNING user_id")
        k.execute("UPDATE app_user SET is_active=false WHERE user_id=%s", (ADM,))
        need(q1_k(k, "SELECT is_active FROM app_user WHERE user_id=%s", (ADM,)) is False, "not deactivated")
    scenario("with a second active admin, deactivating one admin is allowed", t_second_admin, commit=False)
    def t_revoke(k):
        token = "ab" * 32
        k.execute("INSERT INTO user_session(user_id,token_hash,expires_at) VALUES(%s,%s,now()+interval '1 hour')", (H2, token))
        need(q1_k(k, "SELECT count(*) FROM fn_session_principal(%s)", (token,)) == 1, "session not live before")
        k.execute("SELECT set_config('claimguard.actor_id', %s, true)", (str(ADM),))
        k.execute("UPDATE app_user SET is_active=false WHERE user_id=%s", (H2,))
        need(q1_k(k, "SELECT revoked_at IS NOT NULL FROM user_session WHERE token_hash=%s", (token,)), "session not revoked")
        need(q1_k(k, "SELECT count(*) FROM fn_session_principal(%s)", (token,)) == 0, "principal still resolves")
        need(one(k, "SELECT actor_id, details->>'is_active' FROM audit_log WHERE action='USER_STATUS_CHANGED' AND target_user_id=%s ORDER BY audit_id DESC LIMIT 1", (H2,))
             == (ADM, 'false'), "no USER_STATUS_CHANGED audit row with the admin as actor")
    scenario("deactivation revokes live sessions (trigger) and audits USER_STATUS_CHANGED with the admin as actor", t_revoke, commit=False)
    expect_err("a session cannot be issued to an inactive user",
               lambda k: k.execute("INSERT INTO user_session(user_id,token_hash,expires_at) VALUES(%s,%s,now()+interval '1 hour')", (ADJ_OFF, "cd" * 32)), CHK)

passed = sum(1 for r in results if r[1]); failed_ = [r for r in results if not r[1]]
print(f"\nTOTAL {len(results)}  PASS {passed}  FAIL {len(failed_)}")
for r in failed_: print("  FAILED:", r[0], r[2])
sys.exit(1 if failed_ else 0)


