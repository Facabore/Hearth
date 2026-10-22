Feature: Spaces and members screens

  @e2e
  Scenario: A visitor accepts a link invitation after signing up
    Given "Ana" created a link invitation for "Household" with role "MEMBER" and copied its URL
    When a visitor without an account opens the URL
    Then the invitation page shows the space "Household" and the role "MEMBER"
    When the visitor signs up as "juan@example.com"
    Then the visitor is returned to the invitation and accepts it
    And the home of "Household" welcomes the visitor once
    And the members screen of "Household" lists "Juan" as "Member"
