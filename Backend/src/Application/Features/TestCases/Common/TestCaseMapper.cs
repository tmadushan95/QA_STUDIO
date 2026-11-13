using System.Text.Json;
using System.Text.Json.Serialization;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;

namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>Maps stored test cases to API responses.</summary>
internal static class TestCaseMapper
{
    /// <summary>JSON settings of the worker contract: camelCase, and absent rather than null.</summary>
    public static readonly JsonSerializerOptions WorkerJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Builds the response for a read model.</summary>
    /// <param name="model">The read model.</param>
    /// <returns>The response.</returns>
    public static TestCaseResponse ToResponse(TestCaseReadModel model)
    {
        var c = model.TestCase;
        return new TestCaseResponse
        {
            Id = c.CaseCode,
            Title = c.Title,
            Description = c.Description,
            Module = c.Module,
            Preconditions = c.Preconditions,
            Steps = [.. c.Steps.OrderBy(s => s.StepOrder).Select(s => new TestStepResponse(s.StepOrder, s.Action, s.Expected))],
            ExpectedResult = c.ExpectedResult,
            Priority = c.Priority,
            Severity = c.Severity,
            TestType = c.TestType,
            UserRole = c.UserRole,
            Tags = ParseList(c.TagsJson),
            DependsOn = ParseList(c.DependsOnJson),
            Readiness = c.Readiness,
            Source = new TestCaseSourceResponse(c.SourceWorkbook, c.SourceWorksheet, c.SourceRowNumber),
            TestSuiteId = c.TestSuiteId,
            TestSuiteName = model.TestSuiteName,
            ProjectId = model.ProjectId,
            ProjectName = model.ProjectName,
            ProjectVersionId = c.ProjectVersionId,
            ProjectVersionName = model.ProjectVersionName,
            RowVersion = RowVersions.Encode(c.RowVersion),
        };
    }

    /// <summary>Serializes a response for the worker.</summary>
    /// <param name="response">The response.</param>
    /// <returns>Its JSON.</returns>
    public static JsonElement ToWorkerJson(TestCaseResponse response) =>
        JsonSerializer.SerializeToElement(response, WorkerJson);

    /// <summary>Serializes a list to its stored form.</summary>
    /// <param name="values">The values.</param>
    /// <returns>A JSON array.</returns>
    public static string ToJsonList(IEnumerable<string>? values) =>
        JsonSerializer.Serialize(values ?? []);

    private static string[] ParseList(string json) => JsonSerializer.Deserialize<string[]>(json) ?? [];
}
