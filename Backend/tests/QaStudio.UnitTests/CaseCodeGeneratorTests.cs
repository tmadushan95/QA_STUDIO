using QaStudio.Core.TestCases;

namespace QaStudio.UnitTests;

public class CaseCodeGeneratorTests
{
    [Fact]
    public void Starts_from_the_default_pattern_when_nothing_is_numbered() =>
        Assert.Equal("TC_01", CaseCodeGenerator.Next(["free text"]));

    [Fact]
    public void Continues_the_existing_prefix_and_width() =>
        Assert.Equal("TC_31", CaseCodeGenerator.Next(["TC_01", "TC_30"]));

    [Fact]
    public void Keeps_zero_padding_past_a_digit_boundary() =>
        Assert.Equal("ACE-0100", CaseCodeGenerator.Next(["ACE-0098", "ACE-0099"]));

    [Fact]
    public void Follows_the_prefix_most_ids_share() =>
        Assert.Equal("TC_03", CaseCodeGenerator.Next(["ACE-900", "TC_01", "TC_02"]));

    [Fact]
    public void A_tie_goes_to_the_prefix_with_the_highest_number() =>
        Assert.Equal("B-10", CaseCodeGenerator.Next(["A-1", "B-9"]));

    [Fact]
    public void Ignores_a_digit_run_too_long_to_count_from() =>
        Assert.Equal("TC_02", CaseCodeGenerator.Next(["TC_01", "X99999999999999999999999"]));

    [Fact]
    public void Treats_ids_as_exact_strings_like_the_worker_does() =>
        Assert.Equal("tc_2", CaseCodeGenerator.Next(["tc_1"]));
}

