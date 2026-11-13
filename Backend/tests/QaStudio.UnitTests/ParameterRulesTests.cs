using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Core.Common;

namespace QaStudio.UnitTests;

/// <summary>The rules for saving parameter values and for guessing them, carried over from the worker's own tests.</summary>
public class ParameterRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 9, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Values_are_trimmed_and_empty_ones_dropped_so_clearing_a_field_means_no_value_of_its_own()
    {
        var kept = ParameterRules.Normalize(new Dictionary<string, string?> { ["projectCode"] = " PRJ-1 ", ["ownerEmail"] = "", ["blank"] = "   ", ["none"] = null });
        Assert.Equal(new Dictionary<string, string> { ["projectCode"] = "PRJ-1" }, kept);
    }

    [Theory]
    [InlineData("1x")]
    [InlineData("has space")]
    [InlineData("")]
    [InlineData("-dash")]
    public void A_bad_name_is_refused_with_the_field_named(string name)
    {
        var e = Assert.Throws<RequestValidationException>(() => ParameterRules.Normalize(new Dictionary<string, string?> { [name] = "a" }));
        Assert.Equal(ParameterRules.InvalidCode, e.Code);
        Assert.Contains($"values.{name}", e.Fields!.Keys);
    }

    [Fact]
    public void A_value_over_500_characters_and_more_than_200_names_are_refused()
    {
        var long_ = Assert.Throws<RequestValidationException>(() => ParameterRules.Normalize(new Dictionary<string, string?> { ["a"] = new string('x', 501) }));
        Assert.Equal(ParameterRules.InvalidCode, long_.Code);
        var many = Enumerable.Range(0, 201).ToDictionary(i => $"p{i}", _ => (string?)"v");
        Assert.Equal(ParameterRules.TooManyCode, Assert.Throws<RequestValidationException>(() => ParameterRules.Normalize(many)).Code);
        Assert.Equal(200, ParameterRules.Normalize(many.Take(200).ToDictionary(p => p.Key, p => p.Value)).Count);
    }

    [Theory]
    [InlineData("ownerEmail", "qa.20261109@example.com")]
    [InlineData("startDate", "2026-11-09")]
    [InlineData("budgetAmount", "100")]
    [InlineData("projectCode", "QA-20261109")]
    [InlineData("projectName", "QA Project Name 20261109")]
    [InlineData("website", "https://example.com")]
    [InlineData("phoneNumber", "+15555550100")]
    [InlineData("fiscalYear", "2026")]
    [InlineData("something_else", "QA Something Else")]
    public void A_name_is_guessed_into_a_safe_realistic_value(string name, string expected) =>
        Assert.Equal(expected, ParameterGuess.Of(name, Now));

    [Theory]
    [InlineData("password")]
    [InlineData("apiKey")]
    [InlineData("secretAnswer")]
    [InlineData("accessToken")]
    [InlineData("userPin")]
    public void A_name_that_looks_like_a_secret_is_never_guessed(string name) =>
        Assert.Null(ParameterGuess.Of(name, Now));
}
