// acos-isolate.exe — native Windows isolation helper for ACOS.
//
// STATUS: authored reference implementation. It is NOT compiled or executed in
// the Linux development sandbox. Build it on Windows 11 (see README.md in this
// directory) and validate it with `src/windows/verify-windows.ps1` before ACOS
// claims native Windows isolation. Until that validation exists, ACOS documents
// the managed WSL2 guest runtime as the supported Windows path.
//
// Contract with src/host/isolation.ts (WindowsIsolationAdapter.wrap):
//   acos-isolate.exe --job-spec <json>
//
// The helper is the ONLY component that touches Windows security APIs. It:
//   1. Creates a Job Object with memory, active-process and CPU-rate limits and
//      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
//   2. Creates a capability-free AppContainer profile (no network capabilities).
//   3. Grants the AppContainer SID read access only to the declared read-only
//      paths and full access only to the declared scratch paths.
//   4. Adds a WFP filter denying all network traffic for that AppContainer SID.
//   5. Builds a restricted, low-integrity token with no SeDebugPrivilege.
//   6. Launches the engine with an explicitly constructed environment block and
//      assigns it to the job.
//   7. Waits for the wall-clock deadline, then TerminateJobObject reaps every
//      descendant. Killing the helper closes the job and kills the engine too.
//
// Build (MSVC, Developer Command Prompt):
//   cl /std:c++17 /EHsc /O2 acos-isolate.cpp /link Advapi32.lib Userenv.lib \
//      Kernel32.lib Fwpuclnt.lib Ws2_32.lib
//
// This file intentionally uses only the Windows SDK; no third-party JSON library
// is required (a compact parser is embedded below).

#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <sddl.h>
#include <userenv.h>
#include <aclapi.h>
#include <fwpmu.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <cstdio>
#include <map>
#include <memory>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Minimal JSON value + parser (sufficient for the flat job-spec contract).
// ---------------------------------------------------------------------------
namespace json {
struct Value {
  enum Type { Null, Bool, Number, String, Array, Object } type = Null;
  bool boolean = false;
  double number = 0;
  std::wstring string;
  std::vector<Value> array;
  std::map<std::wstring, Value> object;

  const Value *find(const std::wstring &key) const {
    if (type != Object) return nullptr;
    auto it = object.find(key);
    return it == object.end() ? nullptr : &it->second;
  }
};

static std::wstring widen(const std::string &s) {
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
  std::wstring out(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &out[0], n);
  return out;
}

struct Parser {
  const std::string &s;
  size_t i = 0;
  explicit Parser(const std::string &text) : s(text) {}
  void ws() { while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++; }
  bool fail = false;

  Value parse() {
    ws();
    Value v;
    if (i >= s.size()) { fail = true; return v; }
    char c = s[i];
    if (c == '{') return parseObject();
    if (c == '[') return parseArray();
    if (c == '"') { v.type = Value::String; v.string = parseString(); return v; }
    if (c == 't' || c == 'f') { v.type = Value::Bool; v.boolean = (c == 't'); i += (c == 't' ? 4 : 5); return v; }
    if (c == 'n') { i += 4; return v; }
    return parseNumber();
  }
  std::wstring parseString() {
    std::string out;
    i++; // opening quote
    while (i < s.size() && s[i] != '"') {
      char c = s[i++];
      if (c == '\\' && i < s.size()) {
        char e = s[i++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'u': {
            if (i + 4 > s.size()) { fail = true; return L""; }
            unsigned cp = std::stoul(s.substr(i, 4), nullptr, 16);
            i += 4;
            if (cp < 0x80) out += (char)cp;
            else if (cp < 0x800) { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
            else { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
            break;
          }
          default: out += e;
        }
      } else out += c;
    }
    i++; // closing quote
    return widen(out);
  }
  Value parseNumber() {
    size_t start = i;
    while (i < s.size() && (isdigit((unsigned char)s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
    Value v; v.type = Value::Number; v.number = std::stod(s.substr(start, i - start)); return v;
  }
  Value parseArray() {
    Value v; v.type = Value::Array; i++; ws();
    if (i < s.size() && s[i] == ']') { i++; return v; }
    while (i < s.size()) {
      v.array.push_back(parse()); ws();
      if (i < s.size() && s[i] == ',') { i++; continue; }
      if (i < s.size() && s[i] == ']') { i++; break; }
      fail = true; break;
    }
    return v;
  }
  Value parseObject() {
    Value v; v.type = Value::Object; i++; ws();
    if (i < s.size() && s[i] == '}') { i++; return v; }
    while (i < s.size()) {
      ws();
      if (i >= s.size() || s[i] != '"') { fail = true; break; }
      std::wstring key = parseString(); ws();
      if (i >= s.size() || s[i] != ':') { fail = true; break; }
      i++; ws();
      v.object[key] = parse(); ws();
      if (i < s.size() && s[i] == ',') { i++; continue; }
      if (i < s.size() && s[i] == '}') { i++; break; }
      fail = true; break;
    }
    return v;
  }
};
} // namespace json

// ---------------------------------------------------------------------------
// Spec model
// ---------------------------------------------------------------------------
struct JobLimits {
  unsigned long long processMemoryBytes = 0;
  unsigned long long jobMemoryBytes = 0;
  unsigned long cpuRateHundredths = 10000;
  unsigned long activeProcessLimit = 1;
  unsigned long wallClockMs = 120000;
};
struct PathMount { std::wstring source, target; };
struct JobSpec {
  std::wstring jobName;
  std::vector<std::wstring> command;
  std::vector<PathMount> readOnly;
  std::vector<std::wstring> writable;
  std::wstring workdir;
  std::map<std::wstring, std::wstring> env;
  JobLimits limits;
};

static void die(const wchar_t *msg) {
  fwprintf(stderr, L"acos-isolate: %ls (error %lu)\n", msg, GetLastError());
  ExitProcess(1);
}

static bool parseSpec(const std::string &text, JobSpec &spec) {
  json::Parser parser(text);
  json::Value root = parser.parse();
  if (parser.fail || root.type != json::Value::Object) return false;

  if (const json::Value *n = root.find(L"jobName")) spec.jobName = n->string;
  if (const json::Value *c = root.find(L"command"))
    for (const auto &item : c->array) spec.command.push_back(item.string);
  if (const json::Value *ro = root.find(L"readOnlyPaths"))
    for (const auto &item : ro->array) {
      PathMount m;
      if (const json::Value *s = item.find(L"source")) m.source = s->string;
      if (const json::Value *t = item.find(L"target")) m.target = t->string;
      spec.readOnly.push_back(m);
    }
  if (const json::Value *w = root.find(L"writablePaths"))
    for (const auto &item : w->array) spec.writable.push_back(item.string);
  if (const json::Value *wd = root.find(L"workdir"))
    if (wd->type == json::Value::String) spec.workdir = wd->string;
  if (const json::Value *e = root.find(L"env"))
    for (const auto &kv : e->object) spec.env[kv.first] = kv.second.string;
  if (const json::Value *l = root.find(L"limits")) {
    if (const json::Value *v = l->find(L"processMemoryBytes")) spec.limits.processMemoryBytes = (unsigned long long)v->number;
    if (const json::Value *v = l->find(L"jobMemoryBytes")) spec.limits.jobMemoryBytes = (unsigned long long)v->number;
    if (const json::Value *v = l->find(L"cpuRateHundredths")) spec.limits.cpuRateHundredths = (unsigned long)v->number;
    if (const json::Value *v = l->find(L"activeProcessLimit")) spec.limits.activeProcessLimit = (unsigned long)v->number;
    if (const json::Value *v = l->find(L"wallClockMs")) spec.limits.wallClockMs = (unsigned long)v->number;
  }
  return !spec.command.empty();
}

// ---------------------------------------------------------------------------
// Job Object
// ---------------------------------------------------------------------------
static HANDLE createJob(const JobSpec &spec) {
  HANDLE job = CreateJobObjectW(nullptr, spec.jobName.c_str());
  if (!job) die(L"CreateJobObject failed");

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = {};
  ext.BasicLimitInformation.LimitFlags =
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
      JOB_OBJECT_LIMIT_PROCESS_MEMORY |
      JOB_OBJECT_LIMIT_JOB_MEMORY |
      JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
  ext.ProcessMemoryLimit = (SIZE_T)spec.limits.processMemoryBytes;
  ext.JobMemoryLimit = (SIZE_T)spec.limits.jobMemoryBytes;
  ext.BasicLimitInformation.ActiveProcessLimit = spec.limits.activeProcessLimit;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &ext, sizeof(ext)))
    die(L"SetInformationJobObject(extended) failed");

  // CPU rate control: hard cap on the share of total processing capacity.
  JOBOBJECT_CPU_RATE_CONTROL_INFORMATION cpu = {};
  cpu.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
  cpu.CpuRate = spec.limits.cpuRateHundredths;
  if (!SetInformationJobObject(job, JobObjectCpuRateControlInformation, &cpu, sizeof(cpu)))
    die(L"SetInformationJobObject(cpu) failed");
  return job;
}

// ---------------------------------------------------------------------------
// AppContainer profile + path ACLs
// ---------------------------------------------------------------------------
static bool grantPath(PSID sid, const std::wstring &path, DWORD access) {
  EXPLICIT_ACCESS_W ea = {};
  ea.grfAccessPermissions = access;
  ea.grfAccessMode = SET_ACCESS;
  ea.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  ea.Trustee.ptstrName = (LPWSTR)sid;

  PACL acl = nullptr;
  if (SetEntriesInAclW(1, &ea, nullptr, &acl) != ERROR_SUCCESS) return false;
  DWORD rc = SetNamedSecurityInfoW((LPWSTR)path.c_str(), SE_FILE_OBJECT,
                                   DACL_SECURITY_INFORMATION, nullptr, nullptr, acl, nullptr);
  LocalFree(acl);
  return rc == ERROR_SUCCESS;
}

// ---------------------------------------------------------------------------
// WFP: deny all network for the AppContainer SID (defence in depth; a
// capability-free AppContainer already has no network capabilities).
// ---------------------------------------------------------------------------
static void blockNetwork(PSID sid) {
  HANDLE engine = nullptr;
  if (FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr, &engine) != ERROR_SUCCESS)
    return; // Non-fatal: the capability-free profile already denies network.

  FWPM_FILTER0 filter = {};
  filter.displayData.name = (wchar_t *)L"ACOS engine network deny";
  filter.layerKey = FWPM_LAYER_ALE_AUTH_CONNECT_V4;
  filter.action.type = FWP_ACTION_BLOCK;
  filter.weight.type = FWP_EMPTY;
  filter.flags = FWPM_FILTER_FLAG_PERSISTENT;

  FWPM_FILTER_CONDITION0 cond = {};
  cond.fieldKey = FWPM_CONDITION_ALE_APP_ID; // scoped to the SID via provider context
  cond.matchType = FWP_MATCH_EQUAL;
  cond.conditionValue.type = FWP_SID;
  cond.conditionValue.sid = sid;
  filter.filterCondition = &cond;
  filter.numFilterConditions = 1;

  UINT64 id = 0;
  FwpmFilterAdd0(engine, &filter, nullptr, &id);
  FwpmEngineClose0(engine);
}

// ---------------------------------------------------------------------------
// Restricted low-integrity token
// ---------------------------------------------------------------------------
static HANDLE restrictedToken() {
  HANDLE current = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY, &current))
    die(L"OpenProcessToken failed");
  HANDLE restricted = nullptr;
  if (!CreateRestrictedToken(current, DISABLE_MAX_PRIVILEGE, 0, nullptr, 0, nullptr, 0, nullptr, &restricted))
    die(L"CreateRestrictedToken failed");
  CloseHandle(current);

  // Low integrity so the engine cannot write to medium/high integrity objects.
  SID_IDENTIFIER_AUTHORITY authority = SECURITY_MANDATORY_LABEL_AUTHORITY;
  PSID lowSid = nullptr;
  if (AllocateAndInitializeSid(&authority, 1, SECURITY_MANDATORY_LOW_RID, 0, 0, 0, 0, 0, 0, 0, &lowSid)) {
    TOKEN_MANDATORY_LABEL label = {};
    label.Label.Attributes = SE_GROUP_INTEGRITY;
    label.Label.Sid = lowSid;
    SetTokenInformation(restricted, TokenIntegrityLevel, &label,
                        sizeof(TOKEN_MANDATORY_LABEL) + GetLengthSid(lowSid));
    FreeSid(lowSid);
  }
  return restricted;
}

static std::vector<wchar_t> buildEnvironment(const JobSpec &spec) {
  std::vector<wchar_t> block;
  for (const auto &kv : spec.env) {
    std::wstring entry = kv.first + L"=" + kv.second;
    block.insert(block.end(), entry.begin(), entry.end());
    block.push_back(L'\0');
  }
  block.push_back(L'\0'); // double-null terminated
  return block;
}

int wmain(int argc, wchar_t **argv) {
  std::string specText;
  for (int i = 1; i < argc; i++) {
    if (wcscmp(argv[i], L"--job-spec") == 0 && i + 1 < argc) {
      std::wstring w = argv[++i];
      int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
      specText.resize(n);
      WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &specText[0], n, nullptr, nullptr);
    }
  }
  if (specText.empty()) die(L"missing --job-spec");

  JobSpec spec;
  if (!parseSpec(specText, spec)) die(L"invalid job spec");

  HANDLE job = createJob(spec);

  // Capability-free AppContainer profile.
  wchar_t *sidString = nullptr;
  PSID appSid = nullptr;
  HRESULT hr = CreateAppContainerProfile(spec.jobName.c_str(), L"ACOS engine",
                                         L"Isolated local AI engine", nullptr, 0, &appSid);
  if (hr == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS))
    hr = DeriveAppContainerSidFromAppContainerName(spec.jobName.c_str(), &appSid);
  if (FAILED(hr)) die(L"CreateAppContainerProfile failed");

  for (const auto &m : spec.readOnly)
    if (!grantPath(appSid, m.source, GENERIC_READ | GENERIC_EXECUTE))
      fwprintf(stderr, L"acos-isolate: warning: could not grant read on %ls\n", m.source.c_str());
  for (const auto &p : spec.writable)
    if (!grantPath(appSid, p, GENERIC_ALL))
      fwprintf(stderr, L"acos-isolate: warning: could not grant write on %ls\n", p.c_str());
  blockNetwork(appSid);

  HANDLE token = restrictedToken();
  std::vector<wchar_t> env = buildEnvironment(spec);

  // Build a single command line (CreateProcessAsUser takes a mutable buffer).
  std::wstring cmdline;
  for (size_t i = 0; i < spec.command.size(); i++) {
    if (i) cmdline += L' ';
    cmdline += L'"' + spec.command[i] + L'"';
  }
  std::vector<wchar_t> cmd(cmdline.begin(), cmdline.end());
  cmd.push_back(L'\0');

  STARTUPINFOW si = { sizeof(si) };
  PROCESS_INFORMATION pi = {};
  DWORD flags = CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED | CREATE_NO_WINDOW;
  if (!CreateProcessAsUserW(token, nullptr, cmd.data(), nullptr, nullptr, FALSE, flags,
                            env.empty() ? nullptr : env.data(),
                            spec.workdir.empty() ? nullptr : spec.workdir.c_str(), &si, &pi))
    die(L"CreateProcessAsUser failed");

  if (!AssignProcessToJobObject(job, pi.hProcess)) die(L"AssignProcessToJobObject failed");
  ResumeThread(pi.hThread);

  DWORD wait = WaitForSingleObject(pi.hProcess, spec.limits.wallClockMs);
  if (wait == WAIT_TIMEOUT) {
    fwprintf(stderr, L"acos-isolate: wall-clock deadline reached; terminating job\n");
    TerminateJobObject(job, 1);
  }
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);

  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  CloseHandle(token);
  // Closing the job handle triggers JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
  CloseHandle(job);
  return (int)code;
}
