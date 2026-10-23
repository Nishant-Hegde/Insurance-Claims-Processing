import psycopg2, random, sys, subprocess, json, os, pathlib
from psycopg2 import errors

if len(sys.argv) < 2:
    raise SystemExit("Usage: python claimguard_tests_v4.py claimguard_test_<yourname> [schema.sql]")
DB = sys.argv[1]
if not DB.startswith("claimguard_test_") or not DB.replace("_", "").isalnum():
    raise SystemExit("Safety stop: test database name must start with claimguard_test_ and contain only letters, digits, underscores. The runner recreates this database.")
SCHEMA = str(pathlib.Path(sys.argv[2]).resolve()) if len(sys.argv) > 2 else str(pathlib.Path(__file__).with_name("claimguard_schema_v4.sql"))
if not pathlib.Path(SCHEMA).is_file():
    raise SystemExit(f"Schema file not found: {SCHEMA}")
# No shell=True: the DB name and schema path are passed as separate argv items.
subprocess.run(["dropdb", "--if-exists", DB], check=True, capture_output=True, text=True)
subprocess.run(["createdb", DB], check=True, capture_output=True, text=True)
subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB, "-f", SCHEMA], check=True, capture_output=True, text=True)

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
a("audit: assessment of a different claim rejected", lambda k: au(k,'SYSTEM',None,'SCREENING_COMPLETED',claim_id=c1,assessment_id=aid3), FK)
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

passed = sum(1 for r in results if r[1]); failed_ = [r for r in results if not r[1]]
print(f"\nTOTAL {len(results)}  PASS {passed}  FAIL {len(failed_)}")
for r in failed_: print("  FAILED:", r[0], r[2])
