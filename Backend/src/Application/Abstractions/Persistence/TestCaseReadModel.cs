using QaStudio.Core.TestCases;

namespace QaStudio.Application.Abstractions;

/// <summary>A test case as read, with its place in the hierarchy.</summary>
/// <param name="TestCase">The case with its steps.</param>
/// <param name="TestSuiteName">The suite's name.</param>
/// <param name="ProjectId">The project's key.</param>
/// <param name="ProjectName">The project's name.</param>
/// <param name="ProjectVersionName">The version's name, when the case has one.</param>
public sealed record TestCaseReadModel(TestCase TestCase, string TestSuiteName, int ProjectId, string ProjectName, string? ProjectVersionName);
