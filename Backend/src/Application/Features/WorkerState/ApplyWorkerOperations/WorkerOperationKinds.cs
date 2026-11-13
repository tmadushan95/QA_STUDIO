namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>Every kind of write the worker sends, as its <c>RemoteStorage</c> names them.</summary>
public static class WorkerOperationKinds
{
    /// <summary>Insert or replace a test case.</summary>
    public const string TestCaseUpsert = "test-case.upsert";

    /// <summary>Delete a test case.</summary>
    public const string TestCaseDelete = "test-case.delete";

    /// <summary>Delete every test case.</summary>
    public const string TestCaseDeleteAll = "test-case.delete-all";

    /// <summary>Put a restored backup's cases back where they were filed.</summary>
    public const string BackupRestored = "backup.restored";

    /// <summary>Insert or replace a scenario.</summary>
    public const string ScenarioUpsert = "scenario.upsert";

    /// <summary>Delete a scenario.</summary>
    public const string ScenarioDelete = "scenario.delete";

    /// <summary>Delete every scenario.</summary>
    public const string ScenarioDeleteAll = "scenario.delete-all";

    /// <summary>Insert or replace a scenario revision.</summary>
    public const string RevisionUpsert = "revision.upsert";

    /// <summary>Insert or replace a run.</summary>
    public const string RunUpsert = "run.upsert";

    /// <summary>Delete every run.</summary>
    public const string RunDeleteAll = "run.delete-all";

    /// <summary>Insert or replace a configuration block.</summary>
    public const string ConfigUpsert = "config.upsert";

    /// <summary>Insert or replace a test account.</summary>
    public const string AccountUpsert = "account.upsert";

    /// <summary>Delete a test account.</summary>
    public const string AccountDelete = "account.delete";

    /// <summary>Insert or replace a saved session.</summary>
    public const string SessionUpsert = "session.upsert";

    /// <summary>Delete a saved session.</summary>
    public const string SessionDelete = "session.delete";

    /// <summary>Insert or replace an AI provider key.</summary>
    public const string AiKeyUpsert = "ai-key.upsert";

    /// <summary>Delete an AI provider key.</summary>
    public const string AiKeyDelete = "ai-key.delete";

    /// <summary>Add an audit entry.</summary>
    public const string AuditAdd = "audit.add";

    /// <summary>Insert or replace a backup.</summary>
    public const string BackupUpsert = "backup.upsert";

    /// <summary>Delete a backup.</summary>
    public const string BackupDelete = "backup.delete";
}
